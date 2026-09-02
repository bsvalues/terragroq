// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { persistToolRunTranscript } from "@/components/workspace-shell/tool-run-history"
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

async function openWilliamConversation() {
  const trigger = await screen.findByRole("button", { name: "Open William conversation" })
  await userEvent.click(trigger)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message William" })))
  return trigger
}

describe("durable William conversation rail", () => {
  it("disables Override while an existing William turn is pending and dispatches nothing else", async () => {
    let resolveLine!: (response: Response) => void
    const lineResponse = new Promise<Response>((resolve) => { resolveLine = resolve })
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
        return lineResponse
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    const composer = await screen.findByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement
    await userEvent.type(composer, "Finish the earlier turn")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))
    await waitFor(() => expect(lineBodies).toHaveLength(1))

    const override = screen.getByRole("button", { name: "Override William judgment" }) as HTMLButtonElement
    expect(override.disabled).toBe(true)
    await userEvent.click(override)
    expect(composer.value).toBe("Finish the earlier turn")
    expect(lineBodies).toEqual([{ worldId: "world-a", text: "Finish the earlier turn" }])

    resolveLine(Response.json({ worldId: "world-a", say: "Earlier turn complete.", spine: EMPTY_SPINE }))
    await screen.findByText("Earlier turn complete.")
  })

  it("does not let a successful older turn clear a newer unsent draft", async () => {
    let resolveLine!: (response: Response) => void
    const lineResponse = new Promise<Response>((resolve) => { resolveLine = resolve })
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
        return lineResponse
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    const composer = await screen.findByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement
    await userEvent.type(composer, "Finish the earlier turn")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))
    await waitFor(() => expect(lineBodies).toHaveLength(1))

    fireEvent.change(composer, { target: { value: "Newer unsent draft" } })
    expect(composer.value).toBe("Newer unsent draft")
    resolveLine(Response.json({ worldId: "world-a", say: "Earlier turn complete.", spine: EMPTY_SPINE }))

    await screen.findByText("Earlier turn complete.")
    expect(composer.value).toBe("Newer unsent draft")
    expect(lineBodies).toEqual([{ worldId: "world-a", text: "Finish the earlier turn" }])
  })

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
    await openWilliamConversation()

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
    await openWilliamConversation()

    const rail = await screen.findByRole("complementary", { name: "William conversation" })
    expect(rail.textContent).toMatch(/System fact:/)
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
    await openWilliamConversation()

    const rail = await screen.findByRole("complementary", { name: "William conversation" })
    expect(rail.textContent).toContain("Keep the save path revision-bound.")
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
    await openWilliamConversation()

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

  it("attaches bounded structured tool outcomes to William without exposing browser transcript text", async () => {
    persistToolRunTranscript(window.localStorage, "server:world-a", {
      schemaVersion: 1,
      id: "run-tests-1",
      operationId: "tests.run",
      operationLabel: "Run the tests",
      alias: "test",
      startedAt: "2026-09-02T04:00:00.000Z",
      endedAt: "2026-09-02T04:02:00.000Z",
      outcome: { status: "completed", code: 1, reason: null },
      lines: [{ channel: "stderr", text: "SECRET_TRANSCRIPT_AND_UNTRUSTED_INSTRUCTIONS" }],
    })
    persistToolRunTranscript(window.localStorage, "server:world-a", {
      schemaVersion: 1,
      id: "run-status-1",
      operationId: "repo.status",
      operationLabel: "What has changed",
      alias: "git status --short",
      startedAt: "2026-09-02T04:03:00.000Z",
      endedAt: "2026-09-02T04:03:01.000Z",
      outcome: { status: "completed", code: 0, reason: null },
      lines: [{ channel: "stdout", text: "README.md" }],
    })
    const lineBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return Response.json({ worldId: "world-a", say: "The latest retained test run exited 1.", spine: EMPTY_SPINE })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    await userEvent.type(screen.getByRole("textbox", { name: "Message William" }), "What is the latest test outcome?")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))
    await screen.findByText("The latest retained test run exited 1.")

    expect(lineBodies).toHaveLength(1)
    expect(lineBodies[0]).toMatchObject({
      worldId: "world-a",
      text: "What is the latest test outcome?",
      lineContext: {
        kind: "tool-run-snapshots",
        runs: [
          { operationId: "tests.run", outcome: { status: "completed", code: 1, reason: null } },
          { operationId: "repo.status", outcome: { status: "completed", code: 0, reason: null } },
        ],
      },
    })
    expect(JSON.stringify(lineBodies[0])).not.toContain("SECRET_TRANSCRIPT_AND_UNTRUSTED_INSTRUCTIONS")
    expect(JSON.stringify(lineBodies[0])).not.toContain('"lines"')
    expect(JSON.stringify(lineBodies[0])).not.toContain('"clientGuard"')
  })

  it("attaches bounded tool outcomes through The Line for natural pass or fail wording", async () => {
    persistToolRunTranscript(window.localStorage, "server:world-a", {
      schemaVersion: 1,
      id: "run-tests-line-1",
      operationId: "tests.run",
      operationLabel: "Run the tests",
      alias: "test",
      startedAt: "2026-09-02T04:00:00.000Z",
      endedAt: "2026-09-02T04:02:00.000Z",
      outcome: { status: "completed", code: 0, reason: null },
      lines: [{ channel: "stdout", text: "SECRET_LINE_TRANSCRIPT" }],
    })
    const lineBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return Response.json({ worldId: "world-a", say: "The retained test run passed.", spine: EMPTY_SPINE })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: "Open William conversation" })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    await userEvent.type(screen.getByRole("textbox", { name: "The Line" }), "Did the tests pass?")
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(screen.getAllByText(/The retained test run passed\./).length).toBeGreaterThan(0))

    expect(lineBodies).toHaveLength(1)
    expect(lineBodies[0]).toMatchObject({
      worldId: "world-a",
      text: "Did the tests pass?",
      lineContext: {
        kind: "tool-run-snapshots",
        runs: [{ operationId: "tests.run", outcome: { status: "completed", code: 0, reason: null } }],
      },
    })
    expect(JSON.stringify(lineBodies[0])).not.toContain("SECRET_LINE_TRANSCRIPT")
    expect(JSON.stringify(lineBodies[0])).not.toContain('"lines"')
    expect(JSON.stringify(lineBodies[0])).not.toContain('"clientGuard"')
  })

  it("does not attach browser tool history to an unrelated William question", async () => {
    persistToolRunTranscript(window.localStorage, "server:world-a", {
      schemaVersion: 1, id: "run-tests-1", operationId: "tests.run", operationLabel: "Run the tests", alias: "test",
      startedAt: "2026-09-02T04:00:00.000Z", endedAt: "2026-09-02T04:02:00.000Z",
      outcome: { status: "completed", code: 1, reason: null }, lines: [],
    })
    let lineBody: Record<string, unknown> | null = null
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return Response.json({ worldId: "world-a", say: "Inspect the selected source next.", spine: EMPTY_SPINE })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    await userEvent.type(screen.getByRole("textbox", { name: "Message William" }), "What should I inspect next?")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))
    await screen.findByText("Inspect the selected source next.")

    expect(lineBody).toEqual({ worldId: "world-a", text: "What should I inspect next?" })
  })

  it("rejects a tool-grounded reply when browser history changes during inference", async () => {
    persistToolRunTranscript(window.localStorage, "server:world-a", {
      schemaVersion: 1, id: "run-tests-1", operationId: "tests.run", operationLabel: "Run the tests", alias: "test",
      startedAt: "2026-09-02T04:00:00.000Z", endedAt: "2026-09-02T04:02:00.000Z",
      outcome: { status: "completed", code: 1, reason: null }, lines: [],
    })
    let resolveLine!: (response: Response) => void
    const lineResponse = new Promise<Response>((resolve) => { resolveLine = resolve })
    let lineRequested = false
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineRequested = true
        return lineResponse
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    const composer = screen.getByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement
    await userEvent.type(composer, "What is the latest test state?")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))
    await waitFor(() => expect(lineRequested).toBe(true))
    persistToolRunTranscript(window.localStorage, "server:world-a", {
      schemaVersion: 1, id: "run-tests-2", operationId: "tests.run", operationLabel: "Run the tests", alias: "test",
      startedAt: "2026-09-02T04:03:00.000Z", endedAt: "2026-09-02T04:04:00.000Z",
      outcome: { status: "completed", code: 0, reason: null }, lines: [],
    })
    resolveLine(Response.json({ worldId: "world-a", say: "The stale run exited 1.", spine: EMPTY_SPINE }))

    await waitFor(() => expect((screen.getByRole("button", { name: "Send to William" }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText("The stale run exited 1.")).toBeNull()
    expect(composer.value).toBe("What is the latest test state?")
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
    await openWilliamConversation()
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
    await openWilliamConversation()
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

  it("keeps William ambient by default and restores trigger focus after Escape on desktop", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url.startsWith("/api/environment/council?") && !init?.method) return Response.json({ history: [] })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    const trigger = await screen.findByRole("button", { name: "Open William conversation" })
    expect(trigger.textContent).toContain("Ask William")
    expect(trigger.textContent).toContain("Keep the save path revision-bound.")
    const closedRail = screen.getByTestId("william-conversation-rail")
    expect(closedRail.getAttribute("aria-hidden")).toBe("true")
    expect(closedRail.hasAttribute("inert")).toBe(true)
    expect(screen.queryByRole("textbox", { name: "Message William" })).toBeNull()

    await userEvent.click(trigger)
    const composer = screen.getByRole("textbox", { name: "Message William" })
    expect(document.activeElement).toBe(composer)
    expect(trigger.tabIndex).toBe(-1)
    expect(trigger.getAttribute("aria-hidden")).toBe("true")
    expect(trigger.hasAttribute("inert")).toBe(true)
    const close = screen.getByRole("button", { name: "Close William conversation" })
    close.focus()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).not.toBe(trigger)
    composer.focus()
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(closedRail.getAttribute("aria-hidden")).toBe("true")
    expect(trigger.tabIndex).toBe(0)
  })

  it("dismisses The Line before the open William drawer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByRole("dialog", { name: "The Line" })).toBeTruthy()

    fireEvent.keyDown(window, { key: "Escape" })

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull())
    expect(screen.getByRole("complementary", { name: "William conversation" }).getAttribute("data-open")).toBe("true")
  })

  it("dismisses Brain Council before the open William drawer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url.startsWith("/api/environment/council?") && !init?.method) return Response.json({ history: [] })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await openWilliamConversation()
    await userEvent.click(screen.getByRole("button", { name: "Open Brain Council" }))
    await screen.findByRole("dialog", { name: "Brain Council history" })

    fireEvent.keyDown(window, { key: "Escape" })

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Brain Council history" })).toBeNull())
    expect(screen.getByRole("complementary", { name: "William conversation" }).getAttribute("data-open")).toBe("true")
  })

  it("keeps the same ambient William drawer behavior on a narrow viewport", async () => {
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
    await userEvent.click(trigger)
    const rail = screen.getByRole("complementary", { name: "William conversation" })
    expect(rail.getAttribute("data-open")).toBe("true")
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message William" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByRole("dialog", { name: "The Line" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    await userEvent.click(screen.getByRole("button", { name: "Close William conversation" }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("keeps restored durable and inspector title bars reachable inside the desktop work area", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "components/workspace-shell/experience-spatial.module.css"), "utf8")
    const layer = css.match(/\.windowLayer\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(layer).toMatch(/inset:\s*89px\s+0\s+0/)
    const usableDesktopWidth = 1440
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
