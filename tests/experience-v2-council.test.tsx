// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor() { return <div>Source editor</div> },
}))

import {
  BrainCouncilSurface,
  CouncilHistoryBrowser,
  type BrainCouncilSession,
} from "@/components/workspace-shell/brain-council-surface"
import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const session: BrainCouncilSession = {
  id: "council-real-session",
  question: "Council the current UX before merge.",
  status: "ready",
  createdAt: "2026-08-27T18:20:00.000Z",
  context: {
    spaceName: "TerraFusion Build",
    kind: "diff",
    label: "PR #1042 · workspace shell",
  },
  members: [
    {
      id: "architect",
      role: "Architect",
      name: "Atlas",
      provider: "127.0.0.1:11434",
      model: "llama3.2:3b",
      status: "ready",
      perspective: "Keep the source and preview spatially independent.",
    },
    {
      id: "risk",
      role: "Recovery / Risk",
      name: "Phoenix",
      provider: "127.0.0.1:11434",
      model: "llama3.2:3b",
      status: "dissenting",
      perspective: "The current save and re-entry evidence is incomplete.",
    },
  ],
  consensus: "Preserve the spatial workflow.",
  dissent: "Re-entry still needs proof.",
  blindSpot: "No narrow-screen evidence exists.",
  recommendation: "Prove close and re-entry before merge.",
  confidence: 78,
  evidence: [
    { id: "selected-context", label: "Selected diff", detail: "PR #1042 · workspace shell in TerraFusion Build" },
    { id: "browser-proof", label: "browser · PASS", detail: "Window behavior passed" },
  ],
  disposition: null,
}

function renderCouncil(currentSession: BrainCouncilSession = session) {
  const onDismiss = vi.fn()
  const onAdvisoryAction = vi.fn()
  render(
    <BrainCouncilSurface
      session={currentSession}
      onDismiss={onDismiss}
      onAdvisoryAction={onAdvisoryAction}
    />,
  )
  return { onDismiss, onAdvisoryAction }
}

describe("Experience V2 Brain Council surface", () => {
  it("binds the advisory session to the selected Space object", () => {
    renderCouncil()
    expect(screen.getByText("TerraFusion Build")).toBeTruthy()
    expect(screen.getByText("diff")).toBeTruthy()
    expect(screen.getByText("PR #1042 · workspace shell")).toBeTruthy()
  })

  it("makes roles primary while keeping provider and model metadata inspectable", () => {
    renderCouncil()
    expect(screen.getByRole("button", { name: /Architect/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Recovery \/ Risk/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Recovery \/ Risk/ }))
    expect(screen.getByText("Phoenix")).toBeTruthy()
    expect(screen.getByText("127.0.0.1:11434 · llama3.2:3b")).toBeTruthy()
    expect(screen.getByText(/save and re-entry evidence is incomplete/)).toBeTruthy()
  })

  it("shows disagreement, blind spots, recommendation confidence, and evidence", () => {
    renderCouncil()
    expect(screen.getByRole("heading", { name: "Strongest dissent" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Blind spot" })).toBeTruthy()
    expect(screen.getByLabelText("78% confidence")).toBeTruthy()
    expect(screen.getByRole("complementary", { name: "Council evidence" })).toBeTruthy()
    expect(screen.getByText("browser · PASS")).toBeTruthy()
  })

  it("routes owner choices through advisory callbacks without implying execution", () => {
    const { onAdvisoryAction } = renderCouncil()
    expect(screen.getByText(/recommendations never execute silently/i)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))
    expect(onAdvisoryAction).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).toHaveBeenCalledWith("approve", session)
  })

  it("shows durable owner direction on current and restored advice and prevents a conflicting second choice", () => {
    const directed = {
      ...session,
      disposition: { direction: "request-changes" as const, recordedAt: "2026-08-29T18:00:00.000Z" },
    }
    const onAdvisoryAction = vi.fn()
    const current = render(<BrainCouncilSurface session={directed} onDismiss={vi.fn()} onAdvisoryAction={onAdvisoryAction} />)
    expect(screen.getByText(/Owner requested changes/)).toBeTruthy()
    expect(screen.getByText(/records direction only; it does not authorize or dispatch execution/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Approve recommendation" }).hasAttribute("disabled")).toBe(true)
    current.unmount()

    render(<BrainCouncilSurface session={directed} historical onDismiss={vi.fn()} onAdvisoryAction={onAdvisoryAction} />)
    expect(screen.getByText(/Owner requested changes/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))
    expect(onAdvisoryAction).not.toHaveBeenCalled()
  })

  it("keeps disposition loading, success, and error live-announced outside the responsive footer note", () => {
    const view = render(<BrainCouncilSurface session={session} busy onDismiss={vi.fn()} onAdvisoryAction={vi.fn()} />)
    let status = screen.getByRole("status")
    expect(status.textContent).toMatch(/Recording owner direction/)
    expect(status.getAttribute("aria-live")).toBe("polite")
    expect(status.hasAttribute("data-council-disposition-status")).toBe(true)

    view.rerender(<BrainCouncilSurface session={{ ...session, disposition: { direction: "approve", recordedAt: "2026-08-29T18:00:00.000Z" } }} onDismiss={vi.fn()} onAdvisoryAction={vi.fn()} />)
    status = screen.getByRole("status")
    expect(status.textContent).toMatch(/Owner approved recommendation/)

    view.rerender(<BrainCouncilSurface session={session} error="COUNCIL_DISPOSITION_CONFLICT" onDismiss={vi.fn()} onAdvisoryAction={vi.fn()} />)
    expect(screen.getByRole("alert").textContent).toContain("COUNCIL_DISPOSITION_CONFLICT")
    expect(screen.getByRole("alert").hasAttribute("data-council-disposition-status")).toBe(true)
  })

  it("dismisses the Council without coupling dismissal to advisory actions", () => {
    const { onDismiss, onAdvisoryAction } = renderCouncil()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Brain Council" }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).not.toHaveBeenCalled()
    expect(screen.getByText(/current Space and its windows stay in place/i)).toBeTruthy()
  })

  it("labels restored sessions as saved advisory provenance, never live consensus", () => {
    render(<BrainCouncilSurface session={session} historical onDismiss={vi.fn()} onAdvisoryAction={vi.fn()} />)
    expect(screen.getByText("Saved advisory")).toBeTruthy()
    expect(screen.getByText(/Aug 27, 2026/)).toBeTruthy()
    expect(screen.queryByText("Recommendation ready")).toBeNull()
  })

  it("selects saved advice without inference or advisory mutation and offers an explicit new Council", () => {
    const onSelect = vi.fn()
    const onNew = vi.fn()
    const onDismiss = vi.fn()
    render(<CouncilHistoryBrowser history={[session]} onSelect={onSelect} onNew={onNew} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole("button", { name: /Council the current UX before merge/ }))
    expect(onSelect).toHaveBeenCalledWith(session)
    expect(onNew).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "New Council" }))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it("contains keyboard focus, dismisses on Escape, and restores the Council trigger", () => {
    const onDismiss = vi.fn()
    const view = render(<button type="button">Open Council</button>)
    const trigger = screen.getByRole("button", { name: "Open Council" })
    trigger.focus()
    view.rerender(<><button type="button">Open Council</button><CouncilHistoryBrowser history={[session]} onSelect={vi.fn()} onNew={vi.fn()} onDismiss={onDismiss} /></>)

    const first = screen.getByRole("button", { name: "New Council" })
    const last = screen.getByRole("button", { name: new RegExp(session.question) })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
    last.focus()
    fireEvent.keyDown(window, { key: "Tab" })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onDismiss).toHaveBeenCalledOnce()
    view.rerender(<button type="button">Open Council</button>)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Council" }))
  })

  it("shows saved-history loading, never a stale live convening state, while GET is delayed", async () => {
    let releaseHistory!: (response: Response) => void
    const delayedHistory = new Promise<Response>((resolve) => { releaseHistory = resolve })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) {
        const space = { ...defaultSpace(), selectedPath: "src/App.tsx", activeWindowId: "editor" as const }
        return Response.json({ worldId: "11111111-1111-4111-8111-111111111111", space: spaceToServer(space), spine: EMPTY_SPINE, project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", browserStorageKey: null })
      }
      if (url === "/api/environment/space" && init?.method === "PUT") return Response.json({ saved: true })
      if (url === "/api/environment/council" && init?.method === "POST") return Response.json({ session })
      if (url.startsWith("/api/environment/council?worldId=")) return delayedHistory
      if (url === "/api/environment/judgment") return Response.json({ error: "unavailable" }, { status: 503 })
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: "Open Brain Council" })

    fireEvent.click(screen.getByRole("button", { name: "Ask Council" }))
    await screen.findByText(session.question)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Brain Council" }))
    fireEvent.click(screen.getByRole("button", { name: "Open Brain Council" }))

    expect(await screen.findByText("Loading saved advisory sessions…")).toBeTruthy()
    expect(screen.queryByText("Convening five real advisory perspectives…")).toBeNull()
    expect(screen.queryByText(session.question)).toBeNull()
    releaseHistory(Response.json({ history: [session] }))
    await waitFor(() => expect(screen.getByRole("button", { name: new RegExp(session.question) })).toBeTruthy())
  })

  it("records a Council disposition from the Space without opening The Line or dispatching execution", async () => {
    const directed = {
      ...session,
      disposition: { direction: "approve" as const, recordedAt: "2026-08-29T18:00:00.000Z" },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) {
        const space = { ...defaultSpace(), selectedPath: "src/App.tsx", activeWindowId: "editor" as const }
        return Response.json({ worldId: "11111111-1111-4111-8111-111111111111", space: spaceToServer(space), spine: EMPTY_SPINE, project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", browserStorageKey: null })
      }
      if (url === "/api/environment/space" && init?.method === "PUT") return Response.json({ saved: true })
      if (url === "/api/environment/council" && init?.method === "POST") return Response.json({ session })
      if (url === "/api/environment/council" && init?.method === "PATCH") return Response.json({ session: directed })
      if (url === "/api/environment/judgment") return Response.json({ error: "unavailable" }, { status: 503 })
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: "Ask Council" })
    fireEvent.click(screen.getByRole("button", { name: "Ask Council" }))
    await screen.findByText(session.question)

    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))

    expect(await screen.findByText(/Owner approved recommendation/)).toBeTruthy()
    expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull()
    const dispositionCall = fetcher.mock.calls.find(([url, init]) => String(url) === "/api/environment/council" && init?.method === "PATCH")
    expect(JSON.parse(String(dispositionCall?.[1]?.body))).toEqual({
      worldId: "11111111-1111-4111-8111-111111111111",
      sessionId: session.id,
      sessionCreatedAt: session.createdAt,
      direction: "approve",
    })
  })

  it("does not let a delayed disposition overwrite history selection or clear the newer history load", async () => {
    let releasePatch!: (response: Response) => void
    let releaseHistory!: (response: Response) => void
    const patchResponse = new Promise<Response>((resolve) => { releasePatch = resolve })
    const historyResponse = new Promise<Response>((resolve) => { releaseHistory = resolve })
    const saved = {
      ...session,
      id: "council-newer-history",
      question: "Saved newer advice",
      createdAt: "2026-08-29T17:00:00.000Z",
      disposition: { direction: "reject" as const, recordedAt: "2026-08-29T17:30:00.000Z" },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) {
        const space = { ...defaultSpace(), selectedPath: "src/App.tsx", activeWindowId: "editor" as const }
        return Response.json({ worldId: "11111111-1111-4111-8111-111111111111", space: spaceToServer(space), spine: EMPTY_SPINE, project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", browserStorageKey: null })
      }
      if (url === "/api/environment/space" && init?.method === "PUT") return Response.json({ saved: true })
      if (url === "/api/environment/council" && init?.method === "POST") return Response.json({ session })
      if (url === "/api/environment/council" && init?.method === "PATCH") return patchResponse
      if (url.startsWith("/api/environment/council?worldId=")) return historyResponse
      if (url === "/api/environment/judgment") return Response.json({ error: "unavailable" }, { status: 503 })
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: "Ask Council" })
    fireEvent.click(screen.getByRole("button", { name: "Ask Council" }))
    await screen.findByText(session.question)
    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))
    await screen.findByText(/Recording owner direction/)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Brain Council" }))
    fireEvent.click(screen.getByRole("button", { name: "Open Brain Council" }))
    expect(await screen.findByText("Loading saved advisory sessions…")).toBeTruthy()

    releasePatch(Response.json({ session: { ...session, disposition: { direction: "approve", recordedAt: "2026-08-29T18:00:00.000Z" } } }))
    await Promise.resolve()
    expect(screen.getByText("Loading saved advisory sessions…")).toBeTruthy()
    expect(screen.queryByText(/Owner approved recommendation/)).toBeNull()

    releaseHistory(Response.json({ history: [saved] }))
    fireEvent.click(await screen.findByRole("button", { name: /Saved newer advice/ }))
    expect(await screen.findByText(/Owner rejected recommendation/)).toBeTruthy()
  })

  it("replaces a conflicting choice with the canonical saved disposition without dispatching", async () => {
    const canonical = {
      ...session,
      disposition: { direction: "reject" as const, recordedAt: "2026-08-29T17:59:00.000Z" },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) {
        const space = { ...defaultSpace(), selectedPath: "src/App.tsx", activeWindowId: "editor" as const }
        return Response.json({ worldId: "11111111-1111-4111-8111-111111111111", space: spaceToServer(space), spine: EMPTY_SPINE, project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", browserStorageKey: null })
      }
      if (url === "/api/environment/space" && init?.method === "PUT") return Response.json({ saved: true })
      if (url === "/api/environment/council" && init?.method === "POST") return Response.json({ session })
      if (url === "/api/environment/council" && init?.method === "PATCH") return Response.json({ error: "COUNCIL_DISPOSITION_CONFLICT", session: canonical }, { status: 409 })
      if (url === "/api/environment/judgment") return Response.json({ error: "unavailable" }, { status: 503 })
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: "Ask Council" })
    fireEvent.click(screen.getByRole("button", { name: "Ask Council" }))
    await screen.findByText(session.question)

    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))

    expect(await screen.findByText("COUNCIL_DISPOSITION_CONFLICT")).toBeTruthy()
    expect(await screen.findByText(/Owner rejected recommendation/)).toBeTruthy()
    expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull()
  })
})
