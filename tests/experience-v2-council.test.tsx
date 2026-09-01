// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

async function openWilliamConversation() {
  fireEvent.click(await screen.findByRole("button", { name: "Open William conversation" }))
  return screen.findByRole("complementary", { name: "William conversation" })
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

  it("returns from current selected-context evidence by dismissing only the Council overlay", () => {
    const { onDismiss, onAdvisoryAction } = renderCouncil()

    fireEvent.click(screen.getByRole("button", { name: "Return to selected context" }))

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).not.toHaveBeenCalled()
  })

  it("keeps arbitrary and world evidence passive and never exposes the return action in saved advice", () => {
    const evidenceSession = {
      ...session,
      evidence: [
        ...session.evidence,
        { id: "world-evidence-spine", label: "Owned outcome", detail: "Experience V2 remains active" },
        { id: "arbitrary-evidence", label: "Review note", detail: "No navigation target is implied" },
      ],
    }
    const view = render(
      <BrainCouncilSurface session={evidenceSession} onDismiss={vi.fn()} onAdvisoryAction={vi.fn()} />,
    )

    expect(screen.getAllByRole("button", { name: "Return to selected context" })).toHaveLength(1)
    expect(screen.getByText("Owned outcome")).toBeTruthy()
    expect(screen.getByText("Review note")).toBeTruthy()

    view.rerender(
      <BrainCouncilSurface historical session={evidenceSession} onDismiss={vi.fn()} onAdvisoryAction={vi.fn()} />,
    )
    expect(screen.queryByRole("button", { name: "Return to selected context" })).toBeNull()
    expect(screen.getByText("Selected diff")).toBeTruthy()
    expect(screen.getByText("Owned outcome")).toBeTruthy()
    expect(screen.getByText("Review note")).toBeTruthy()
  })

  it("supports keyboard return and restores focus to the Council trigger after dismissal", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const onAdvisoryAction = vi.fn()
    const view = render(<button type="button">Open Council</button>)
    screen.getByRole("button", { name: "Open Council" }).focus()
    view.rerender(
      <>
        <button type="button">Open Council</button>
        <BrainCouncilSurface session={session} onDismiss={onDismiss} onAdvisoryAction={onAdvisoryAction} />
      </>,
    )

    const returnAction = screen.getByRole("button", { name: "Return to selected context" })
    returnAction.focus()
    await user.keyboard("{Enter}")
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).not.toHaveBeenCalled()

    view.rerender(<button type="button">Open Council</button>)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Council" }))
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
    const conversation = await openWilliamConversation()
    await screen.findByRole("button", { name: "Open Brain Council" })

    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Council" }))
    await screen.findByText(session.question)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Brain Council" }))
    fireEvent.click(screen.getByRole("button", { name: "Open Brain Council" }))

    expect(await screen.findByText("Loading saved advisory sessions…")).toBeTruthy()
    expect(screen.queryByText("Convening five real advisory perspectives…")).toBeNull()
    expect(screen.queryByText(session.question)).toBeNull()
    releaseHistory(Response.json({ history: [session] }))
    await waitFor(() => expect(screen.getByRole("button", { name: new RegExp(session.question) })).toBeTruthy())
  })

  it.each([
    { role: "HERMES" as const, assignee: "hermes-codex-bridge", providerLabel: "Local execution" },
    { role: "Executor" as const, assignee: "builder-a", providerLabel: "builder-a · codex" },
  ])("convenes Council for a persisted $role worker with only exact Space and Work Order stale guards", async ({ role, assignee, providerLabel }) => {
    const worldId = "11111111-1111-4111-8111-111111111111"
    const spine = {
      ...EMPTY_SPINE,
      projectId: 1,
      projectName: "WilliamOS",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      workOrderId: 41,
      execution: "validating" as const,
      worker: { lane: assignee, state: "validating" as const, since: "2026-09-01T18:00:00.000Z" },
      evidence: [{ kind: "test", detail: "Focused Council suite", result: "PASS", at: "2026-09-01T18:01:00.000Z" }],
    }
    const worker = {
      id: `world-worker:${worldId}:41:${assignee}`,
      worldId,
      workOrderId: 41,
      assignee,
      agent: "codex",
      role,
      providerLabel,
      assignment: "Finish Experience V2 · Work Order #41: Ground Council",
      status: "validating" as const,
      evidence: "test: Focused Council suite · PASS",
      observedAt: "2026-09-01T18:01:00.000Z",
    }
    const assignmentSession = {
      ...session,
      id: `council-${role.toLowerCase()}`,
      question: `Challenge the current direction for ${role} · ${providerLabel}.`,
      context: { spaceName: "WilliamOS", kind: "agent" as const, label: `Work Order #41 · ${assignee} · validating` },
      evidence: [
        { id: "selected-context", label: "Selected agent", detail: `Work Order #41 · ${assignee} · validating in WilliamOS` },
        { id: "assignment-outcome", label: "Outcome", detail: "WILLIAMOS_EXPERIENCE_V2 · Finish Experience V2" },
        { id: "assignment-work-order", label: "Work Order", detail: "#41" },
        { id: "assignment-executor", label: "Executor / provider", detail: assignee },
        { id: "assignment-status", label: "Persisted status", detail: "validating" },
        { id: "world-evidence-1", label: "test · PASS", detail: "Focused Council suite" },
      ],
    }
    const space = defaultSpace(1440, 900, worldId, "Experience V2")
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId, space: spaceToServer(space), spine,
        project: { identity: "c:/repos/william-os-devops", name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") return Response.json({ worldId, space: JSON.parse(String(init.body)).space, spine, judgment: null })
      if (url.startsWith("/api/environment/execution?")) return Response.json({ worldId, ...spine, session: worker })
      if (url.startsWith("/api/loom/codex/continuation")) return Response.json({ status: "WORK_ORDER_PATHS_COMPLETE" })
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/environment/judgment" && init?.method === "POST") return Response.json({ judgment: null })
      if (url === "/api/environment/council" && init?.method === "POST") return Response.json({ session: assignmentSession })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${role} · ${providerLabel}`) }))
    fireEvent.click(screen.getByRole("button", { name: "Council" }))

    expect(await screen.findByText("WILLIAMOS_EXPERIENCE_V2 · Finish Experience V2")).toBeTruthy()
    const evidence = screen.getByRole("complementary", { name: "Council evidence" })
    expect(within(evidence).getByText("#41")).toBeTruthy()
    expect(within(evidence).getByText("Executor / provider")).toBeTruthy()
    expect(within(evidence).getByText(assignee)).toBeTruthy()
    expect(within(evidence).getByText("Persisted status")).toBeTruthy()
    expect(within(evidence).getByText("validating")).toBeTruthy()
    expect(within(evidence).getByText("Focused Council suite")).toBeTruthy()
    const councilCall = fetcher.mock.calls.find(([url, init]) => String(url) === "/api/environment/council" && init?.method === "POST")
    expect(JSON.parse(String(councilCall?.[1]?.body))).toEqual({
      worldId,
      question: `Challenge the current direction for ${role} · ${providerLabel}.`,
      selectedContext: { kind: "agent", workOrderId: 41 },
    })
    expect(fetcher.mock.calls.some(([url]) => String(url) === "/api/environment/hermes")).toBe(false)
  })

  it("keeps a later Council generation visible when an overlapping prior assignment response settles late", async () => {
    const worldId = "11111111-1111-4111-8111-111111111111"
    const spine = {
      ...EMPTY_SPINE,
      projectName: "WilliamOS",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      workOrderId: 41,
      execution: "validating" as const,
      worker: { lane: "builder-a", state: "validating" as const, since: "2026-09-01T18:00:00.000Z" },
    }
    const worker = {
      id: `world-worker:${worldId}:41:builder-a`, worldId, workOrderId: 41,
      assignee: "builder-a", agent: "codex", role: "Executor" as const, providerLabel: "builder-a · codex",
      assignment: "Finish Experience V2 · Work Order #41: Ground Council", status: "validating" as const,
      evidence: "No persisted execution evidence yet", observedAt: "2026-09-01T18:01:00.000Z",
    }
    let releaseFirst!: (response: Response) => void
    let releaseSecond!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { releaseFirst = resolve })
    const second = new Promise<Response>((resolve) => { releaseSecond = resolve })
    let councilCalls = 0
    const space = defaultSpace(1440, 900, worldId, "Experience V2")
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId, space: spaceToServer(space), spine,
        project: { identity: "c:/repos/william-os-devops", name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") return Response.json({ worldId, space: JSON.parse(String(init.body)).space, spine, judgment: null })
      if (url.startsWith("/api/environment/execution?")) return Response.json({ worldId, ...spine, session: worker })
      if (url.startsWith("/api/loom/codex/continuation")) return Response.json({ status: "WORK_ORDER_PATHS_COMPLETE" })
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/environment/judgment" && init?.method === "POST") return Response.json({ judgment: null })
      if (url === "/api/environment/council" && init?.method === "POST") return ++councilCalls === 1 ? first : second
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: /Executor · builder-a · codex/ }))
    fireEvent.click(screen.getByRole("button", { name: "Council" }))
    await waitFor(() => expect(councilCalls).toBe(1))
    fireEvent.click(screen.getByRole("button", { name: "Council" }))
    await waitFor(() => expect(councilCalls).toBe(2))

    releaseSecond(Response.json({ session: { ...session, id: "council-newer", recommendation: "Keep the newer exact assignment advice." } }))
    expect(await screen.findByText("Keep the newer exact assignment advice.")).toBeTruthy()
    releaseFirst(Response.json({ session: { ...session, id: "council-older", recommendation: "STALE prior assignment advice" } }))
    await Promise.resolve()
    expect(screen.queryByText("STALE prior assignment advice")).toBeNull()
    expect(screen.getByText("Keep the newer exact assignment advice.")).toBeTruthy()
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
    const conversation = await openWilliamConversation()
    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Council" }))
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
    const conversation = await openWilliamConversation()
    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Council" }))
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
    const conversation = await openWilliamConversation()
    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Council" }))
    await screen.findByText(session.question)

    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))

    expect(await screen.findByText("COUNCIL_DISPOSITION_CONFLICT")).toBeTruthy()
    expect(await screen.findByText(/Owner rejected recommendation/)).toBeTruthy()
    expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull()
  })
})
