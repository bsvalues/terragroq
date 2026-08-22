// @vitest-environment jsdom

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WorkbenchShell } from "@/components/workbench/workbench-shell"
import { WorkbenchActivity } from "@/components/workbench/workbench-activity"
import type { ProjectView } from "@/lib/operator/operator-state"
import type { Thread } from "@/lib/workbench/thread-projection"
import type { WorkbenchExecutionProjection } from "@/lib/workbench/execution-projection"

const navigation = vi.hoisted(() => ({ pathname: "/", replace: vi.fn() }))
const actions = vi.hoisted(() => ({ getWorkbenchThreads: vi.fn() }))
const executionActions = vi.hoisted(() => ({ getWorkbenchExecution: vi.fn() }))
const authorizationActions = vi.hoisted(() => ({ authorizeWorkbenchOutcomeExecution: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock("@/app/actions/workbench-threads", () => ({ getWorkbenchThreads: actions.getWorkbenchThreads }))
vi.mock("@/app/actions/workbench-execution", () => ({ getWorkbenchExecution: executionActions.getWorkbenchExecution }))
vi.mock("@/app/actions/authorize-workbench-outcome-execution", () => ({ authorizeWorkbenchOutcomeExecution: authorizationActions.authorizeWorkbenchOutcomeExecution }))
vi.mock("@/components/intent/universal-intent", () => ({
  UniversalIntent: ({ selectedProject, onOpenThread }: {
    selectedProject: { id: number; name: string } | null
    onOpenThread: (target: { projectId: number; threadId: string }) => void
  }) => <div>
    <button type="button">Ask or do anything</button>
    <span>Composer Project {selectedProject?.id ?? "none"}</span>
    <button type="button" onClick={() => onOpenThread({ projectId: 7, threadId: "thread-outcome" })}>Open accepted Thread</button>
  </div>,
}))
vi.mock("@/components/shell/user-menu", () => ({
  UserMenu: () => <button type="button">Owner menu</button>,
}))

const projects: ProjectView[] = [{
  id: 7,
  key: "williamos",
  name: "WilliamOS",
  lifecycle: "active",
  resources: [{
    type: "repo",
    canonicalIdentity: "bsvalues/terragroq",
    label: "WilliamOS repository",
    relationship: "primary-repo",
  }],
}]

const thread: Thread = {
  id: "thread-alpha",
  project: { id: 7, key: "williamos", name: "WilliamOS" },
  title: "Ship the cockpit",
  createdAt: new Date("2026-08-14T10:00:00.000Z"),
  lastActivityAt: new Date("2026-08-14T10:05:00.000Z"),
  coverage: {
    truncated: false,
    truncatedSourceKinds: [],
    missingSources: [],
    conflicts: [],
    conversation: "MISSING",
  },
  items: [{
    id: "goal:41:owner-intent",
    kind: "OWNER_INTENT",
    occurredAt: new Date("2026-08-14T10:00:00.000Z"),
    actorRole: "OWNER",
    title: "Owner intent",
    summary: "Make the cockpit usable",
    rawState: null,
    truth: { basis: "PERSISTED", state: "RECORDED", detail: null },
    source: {
      kind: "goal",
      id: "41",
      ref: "GOAL-0041",
      facet: "owner-intent",
      mirrorKey: null,
      drilldown: { mode: "EXACT", href: "/goal-console?goal=41#goal-delivery-timeline" },
    },
  }],
}

const outcomeThread: Thread = {
  ...thread,
  id: "thread-outcome",
  title: "Accepted owner outcome",
  items: [],
}

const readiness = {
  ready: true,
  databaseReady: true,
  authReady: true,
  signup: {},
  checkedAt: "2026-08-14T10:10:00.000Z",
  checks: { databaseUrl: { ok: true }, databaseConnectivity: { ok: true }, authSecret: { ok: true }, baseUrl: { ok: true } },
  emailOtp: {},
  accessGrants: {},
  issues: [],
} as never

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
} as const

function executionProjection(summary: string, observedAt: string | null = "2026-08-14T10:11:00.000Z"): WorkbenchExecutionProjection {
  return {
    availability: "available",
    scope: { projectId: 7, threadId: "thread-alpha" },
    truthState: "persisted",
    observedAt,
    latestPersistedAt: "2026-08-14T10:10:00.000Z",
    freshness: { state: "fresh", detail: null },
    work: { outcomes: [], workOrders: [] },
    agents: [], attempts: [],
    validations: [{
      id: `validation-${summary}`,
      state: "CI_PASSED",
      summary,
      occurredAt: "2026-08-14T10:10:00.000Z",
      truthState: "persisted",
      drilldown: { mode: "UNAVAILABLE", href: null },
    }],
    reviews: [], remediations: [], deliveries: [], events: [], evidence: [], recoveries: [],
    coverage: { truncated: false, truncatedKinds: [], missing: [], conflicts: [] },
    controls: { terminal: false, steer: false, pause: false, stop: false },
  }
}

function projectionWithOutcome(state: string): WorkbenchExecutionProjection {
  const base = executionProjection(`Outcome ${state}`)
  return {
    ...base,
    work: {
      outcomes: [{ id: "goal:GOAL-0007", title: "Ship the cockpit", state, drilldown: { mode: "UNAVAILABLE", href: null } }],
      workOrders: [],
    },
    validations: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function renderShell(options?: {
  projectState?: "available" | "degraded"
  projectRows?: ProjectView[]
  child?: React.ReactNode
}) {
  return render(
    <WorkbenchShell
      user={{ id: "owner-1", name: "William", email: "owner@example.test" }}
      projects={options?.projectRows ?? projects}
      projectState={options?.projectState ?? "available"}
      pulse={{ working: 1, needsYou: 0, queueDepth: 1 }}
      readiness={readiness}
      runtime={runtime}
      observedAt="2026-08-14T10:10:00.000Z"
    >
      {options?.child ?? <p>Mode content</p>}
    </WorkbenchShell>,
  )
}

describe("WorkbenchShell rendered interaction contract", () => {
  beforeEach(() => {
    navigation.pathname = "/"
    navigation.replace.mockReset()
    actions.getWorkbenchThreads.mockReset()
    actions.getWorkbenchThreads.mockResolvedValue([thread])
    executionActions.getWorkbenchExecution.mockReset()
    executionActions.getWorkbenchExecution.mockImplementation(() => new Promise(() => {}))
    authorizationActions.authorizeWorkbenchOutcomeExecution.mockReset()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("loads by durable Project id and reloads when the selected Project is explicitly chosen again", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await waitFor(() => expect(actions.getWorkbenchThreads).toHaveBeenCalledWith(7))
    await screen.findByRole("option", { name: /Ship the cockpit/ })

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await waitFor(() => expect(actions.getWorkbenchThreads).toHaveBeenCalledTimes(2))
  })

  it("shows runtime finding decision detail read-only without changing route, focus, selection, or tab", async () => {
    const decisionThread: Thread = {
      ...thread,
      items: [...thread.items, {
        id: "governance_event:501:decision",
        kind: "DECISION",
        occurredAt: new Date("2026-08-20T16:00:00.000Z"),
        actorRole: "OWNER",
        title: "Runtime finding needs your decision",
        summary: "changes reviewed policy",
        rawState: "ACTIONABLE",
        truth: { basis: "PERSISTED", state: "CURRENT", detail: "Canonical request" },
        source: { kind: "governance_event", id: "501", ref: null, facet: "decision", mirrorKey: null, drilldown: { mode: "UNAVAILABLE", href: null } },
        decision: {
          state: "ACTIONABLE",
          why: "changes reviewed policy",
          blockedAction: "Materialize gated work",
          gates: ["POLICY"],
          recommendation: "DENY",
          recommendationRationale: "Default deny",
          choices: ["APPROVE", "DENY"],
          consequences: { APPROVE: "Record authority only", DENY: "Resolve denied" },
        },
      }],
    }
    actions.getWorkbenchThreads.mockResolvedValue([decisionThread])
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true")
    expect(navigation.replace).not.toHaveBeenCalled()

    await user.click(screen.getByRole("tab", { name: "Decision" }))

    const panel = within(screen.getByRole("tabpanel"))
    expect(panel.getByText("changes reviewed policy")).toBeTruthy()
    expect(panel.getByText("Materialize gated work")).toBeTruthy()
    expect(panel.getByText("POLICY")).toBeTruthy()
    expect(panel.getByText("DENY", { selector: "dd" })).toBeTruthy()
    expect(panel.getByText("APPROVE — Record authority only")).toBeTruthy()
    expect(panel.getByText("DENY — Resolve denied")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /approve|deny/i })).toBeNull()
    expect(screen.queryByRole("link", { name: /decisions/i })).toBeNull()
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(screen.getByRole("option", { name: /Ship the cockpit/ }).getAttribute("aria-selected")).toBe("true")
  })

  it("keeps explicit Activity and System mode content reachable after a Thread is selected", async () => {
    const user = userEvent.setup()
    const view = renderShell({ child: <p>Home mode content</p> })
    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    expect(screen.getByRole("heading", { name: "Ship the cockpit" })).toBeTruthy()

    navigation.pathname = "/activity"
    view.rerender(
      <WorkbenchShell user={{ id: "owner-1", name: "William", email: "owner@example.test" }} projects={projects} projectState="available" pulse={{ working: 1, needsYou: 0, queueDepth: 1 }} readiness={readiness} runtime={runtime} observedAt="2026-08-14T10:10:00.000Z">
        <p>Activity mode content</p>
      </WorkbenchShell>,
    )
    expect(screen.getByText("Activity mode content")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Ship the cockpit" })).toBeNull()

    navigation.pathname = "/runtime"
    view.rerender(
      <WorkbenchShell user={{ id: "owner-1", name: "William", email: "owner@example.test" }} projects={projects} projectState="available" pulse={{ working: 1, needsYou: 0, queueDepth: 1 }} readiness={readiness} runtime={runtime} observedAt="2026-08-14T10:10:00.000Z">
        <p>Raw Runtime technical detail</p>
      </WorkbenchShell>,
    )
    expect(screen.getByText("Raw Runtime technical detail")).toBeTruthy()
  })

  it("reloads an already-selected Project and resolves an explicit Activity Thread focus without guessing", async () => {
    navigation.pathname = "/activity"
    const user = userEvent.setup()
    const activity = {
      items: [{
        id: 99,
        at: "2026-08-14T10:05:00.000Z",
        kind: "goal" as const,
        label: "Goal created",
        detail: "GOAL-0041",
        ref: "GOAL-0041",
        threadId: "thread-alpha",
        projectId: 7,
      }],
      churnCollapsed: 0,
      source: "governance_event",
      latestEventAt: "2026-08-14T10:05:00.000Z",
      observedAt: "2026-08-14T10:10:00.000Z",
      truthState: "persisted" as const,
    }
    const view = renderShell({ child: <WorkbenchActivity feed={activity} /> })

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await screen.findByRole("option", { name: /Ship the cockpit/ })
    await user.click(screen.getByRole("button", { name: "Focus thread" }))
    await waitFor(() => expect(actions.getWorkbenchThreads).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole("option", { name: /Ship the cockpit/ }).getAttribute("aria-selected")).toBe("true"))
    expect(document.activeElement).toBe(screen.getByRole("main"))

    navigation.pathname = "/"
    view.rerender(
      <WorkbenchShell user={{ id: "owner-1", name: "William", email: "owner@example.test" }} projects={projects} projectState="available" pulse={{ working: 1, needsYou: 0, queueDepth: 1 }} readiness={readiness} runtime={runtime} observedAt="2026-08-14T10:10:00.000Z">
        <p>Home mode content</p>
      </WorkbenchShell>,
    )
    expect(screen.getByRole("heading", { name: "Ship the cockpit" })).toBeTruthy()
  })

  it("distinguishes a failed Project projection from a canonical empty Project register", () => {
    const degraded = renderShell({ projectState: "degraded", projectRows: [] })
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Project context unavailable")
    degraded.unmount()

    renderShell({ projectState: "available", projectRows: [] })
    expect(screen.getByText("No durable Projects are registered.")).toBeTruthy()
  })

  it("persists only non-secret spatial state in an authenticated-user scoped device profile key", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))

    await waitFor(() => {
      const serialized = window.localStorage.getItem("williamos.workbench.layout.v1:owner-1")
      expect(serialized).toContain('"selectedProjectId":"7"')
      expect(serialized).not.toMatch(/token|cookie|secret|email/i)
    })
  })

  it("returns a restarted Cockpit to its persisted primary mode instead of forcing Home", async () => {
    window.localStorage.setItem("williamos.workbench.layout.v1:owner-1", JSON.stringify({
      schemaVersion: 1,
      selectedProjectId: "7",
      selectedThreadId: null,
      viewMode: "activity",
      inspectorTab: "overview",
      executionExpanded: true,
      foregroundFocus: "thread",
      mobilePane: "thread",
    }))

    renderShell()

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/activity"))
    await waitFor(() => {
      const serialized = window.localStorage.getItem("williamos.workbench.layout.v1:owner-1")
      expect(serialized).toContain('"viewMode":"activity"')
      expect(serialized).toContain('"executionExpanded":true')
    })
  })

  it("degrades safely when authenticated-user layout storage is unavailable", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })

    expect(() => renderShell()).not.toThrow()
    expect(screen.getByRole("navigation", { name: "Workbench views" })).toBeTruthy()
    getItem.mockRestore()
    cleanup()

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError")
    })
    expect(() => renderShell()).not.toThrow()
    expect(screen.getByRole("navigation", { name: "Workbench views" })).toBeTruthy()
    setItem.mockRestore()
  })

  it("clears a superseded restoration route and persists the route the owner actually selected", async () => {
    window.localStorage.setItem("williamos.workbench.layout.v1:owner-1", JSON.stringify({
      schemaVersion: 1,
      selectedProjectId: "7",
      selectedThreadId: null,
      viewMode: "activity",
      inspectorTab: "overview",
      executionExpanded: false,
      foregroundFocus: "thread",
      mobilePane: "thread",
    }))

    const view = renderShell()
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/activity"))

    navigation.pathname = "/system"
    view.rerender(
      <WorkbenchShell user={{ id: "owner-1", name: "William", email: "owner@example.test" }} projects={projects} projectState="available" pulse={{ working: 1, needsYou: 0, queueDepth: 1 }} readiness={readiness} runtime={runtime} observedAt="2026-08-14T10:10:00.000Z">
        <p>System mode content</p>
      </WorkbenchShell>,
    )

    await waitFor(() => {
      const serialized = window.localStorage.getItem("williamos.workbench.layout.v1:owner-1")
      expect(serialized).toContain('"viewMode":"system"')
    })
  })

  it("moves focus only after explicit selection and supports keyboard Inspector tabs and compact panes", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")))

    const overview = screen.getByRole("tab", { name: "Overview" })
    overview.focus()
    await user.keyboard("{ArrowRight}")
    const changes = screen.getByRole("tab", { name: "Changes" })
    // Roving focus is applied in an effect, so it lands in the same commit as the selection. No
    // waiting: if this needed a timeout it would mean focus trails the keystroke by an unbounded
    // amount on a loaded machine, which is the defect this asserts against (issue #811).
    expect(changes.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(changes)

    await user.click(screen.getByRole("button", { name: /Inspect/ }))
    expect(screen.getByRole("button", { name: /Inspect/ }).getAttribute("aria-pressed")).toBe("true")

    const compactViews = screen.getByRole("navigation", { name: "Compact Workbench views" })
    expect(Array.from(compactViews.querySelectorAll("a")).map((link) => link.textContent?.trim())).toEqual([
      // The Environment doorway leads the nav — a link OUT to the Desk (real-operator acceptance).
      "Environment",
      "Home",
      "Activity",
      "System",
    ])
    // And that first link goes to /environment, not an internal shell view.
    expect(compactViews.querySelector("a")?.getAttribute("href")).toBe("/environment")
  })

  it("keeps compact Execution truthful when no Thread is selected", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("button", { name: /^Execution$/ }))

    expect(screen.getByText("Select a Thread to inspect execution.")).toBeTruthy()
    expect(screen.getByText("No governed terminal protocol is available.")).toBeTruthy()
  })

  it("keeps desktop Execution collapsed until its explicit toggle is used", async () => {
    const user = userEvent.setup()
    renderShell()
    const toggle = screen.getByRole("button", { name: /Execution agents · tests · logs/ })

    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("region", { name: "Selected Thread execution" })).toBeNull()

    await user.click(toggle)

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("region", { name: "Selected Thread execution" })).toBeTruthy()
    expect(document.activeElement).toBe(toggle)
  })

  it("shows bounded loading truth after a Thread is explicitly selected", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))

    await user.click(screen.getByRole("button", { name: /^Execution$/ }))

    expect(screen.getByText("Reading selected Thread execution…")).toBeTruthy()
  })

  it("loads execution only for the explicitly selected Project and Thread", async () => {
    executionActions.getWorkbenchExecution.mockResolvedValue(executionProjection("Selected execution proof"))
    const user = userEvent.setup()
    renderShell()

    expect(executionActions.getWorkbenchExecution).not.toHaveBeenCalled()
    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    expect(executionActions.getWorkbenchExecution).not.toHaveBeenCalled()
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    await waitFor(() => expect(executionActions.getWorkbenchExecution).toHaveBeenCalledWith(7, "thread-alpha"))
    await user.click(screen.getByRole("button", { name: /^Execution$/ }))

    expect(await screen.findByText("Selected execution proof")).toBeTruthy()
  })

  it("keeps selected Thread trust visible and authorizes only after explicit confirmation without opening panes", async () => {
    executionActions.getWorkbenchExecution.mockResolvedValue(projectionWithOutcome("suggested"))
    authorizationActions.authorizeWorkbenchOutcomeExecution.mockResolvedValue({
      status: "AUTHORIZED_FOR_ACQUISITION", reason: null,
      projectId: 7, threadId: "thread-alpha", outcomeKey: "goal:GOAL-0007",
      observedAt: "2026-08-14T18:01:00.000Z", queueVersion: 1,
      authorization: { authorityLevel: "A2_WRITE_OWN", scope: "goal:GOAL-0007", allowedAction: "outcome:execute", authorizedAt: "2026-08-14T18:01:00.000Z", expiresAt: "2026-08-17T18:01:00.000Z" },
      executionObserved: false, workOrderObserved: false, leaseObserved: false, dispatchPerformed: false,
    })
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    expect(await screen.findByText("Awaiting authority")).toBeTruthy()
    expect(authorizationActions.authorizeWorkbenchOutcomeExecution).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Start work" }))
    const confirm = screen.getByRole("button", { name: "Confirm Start work" })
    await user.click(confirm)
    expect(await screen.findByText("Authorized for acquisition")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Thread$/ }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: /^Execution / }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(confirm)
  })

  it("serializes selected Thread online refresh and never changes foreground state", async () => {
    const initial = deferred<WorkbenchExecutionProjection>()
    const queued = deferred<WorkbenchExecutionProjection>()
    executionActions.getWorkbenchExecution
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => queued.promise)
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    await waitFor(() => expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole("tab", { name: "Proof" }))
    const intent = screen.getByRole("button", { name: "Ask or do anything" })
    intent.focus()

    window.dispatchEvent(new Event("online"))
    window.dispatchEvent(new Event("online"))
    expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(1)
    await act(async () => initial.resolve(projectionWithOutcome("suggested")))
    await waitFor(() => expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(2))
    await act(async () => queued.resolve(projectionWithOutcome("approved")))

    expect(document.activeElement).toBe(intent)
    expect(screen.getByRole("tab", { name: "Proof" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("button", { name: /^Thread$/ }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: /^Execution / }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByText("Authorized")).toBeTruthy()
  })

  it("periodically refreshes only the selected exact Thread", async () => {
    vi.useFakeTimers()
    executionActions.getWorkbenchExecution.mockResolvedValue(projectionWithOutcome("approved"))
    renderShell()

    fireEvent.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole("option", { name: /Ship the cockpit/ }))
    await act(async () => { await Promise.resolve() })
    expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(2)
    expect(executionActions.getWorkbenchExecution).toHaveBeenLastCalledWith(7, "thread-alpha")
  })

  it("passes explicit Project context and opens an accepted Thread only from the explicit action", async () => {
    const user = userEvent.setup()
    renderShell()

    expect(screen.getByText("Composer Project none")).toBeTruthy()
    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await waitFor(() => expect(screen.getByText("Composer Project 7")).toBeTruthy())
    actions.getWorkbenchThreads.mockResolvedValue([outcomeThread])

    await user.click(screen.getByRole("button", { name: "Open accepted Thread" }))

    await waitFor(() => expect(screen.getByRole("option", { name: /Accepted owner outcome/ }).getAttribute("aria-selected")).toBe("true"))
    expect(screen.getByRole("heading", { name: "Accepted owner outcome" })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole("main"))
  })

  it("renders an execution read error without changing the selected Thread", async () => {
    executionActions.getWorkbenchExecution.mockRejectedValue(new Error("read failed"))
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    await user.click(screen.getByRole("button", { name: /^Execution$/ }))

    expect(await screen.findByText(/Execution evidence could not be read/)).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Ship the cockpit" })).toBeTruthy()
  })

  it("renders a successful degraded projection without inventing a missing observation time", async () => {
    executionActions.getWorkbenchExecution.mockResolvedValue(executionProjection("Persisted truth without observation time", null))
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    await user.click(screen.getByRole("button", { name: /^Execution$/ }))

    expect(await screen.findByText("Persisted truth without observation time")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Ship the cockpit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Execution$/ }).getAttribute("aria-pressed")).toBe("true")
  })

  it("ignores stale execution responses without stealing foreground pane, Inspector, or focus", async () => {
    const first = deferred<WorkbenchExecutionProjection>()
    const second = deferred<WorkbenchExecutionProjection>()
    executionActions.getWorkbenchExecution
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    await waitFor(() => expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole("option", { name: /WilliamOS/ }))
    await user.click(await screen.findByRole("option", { name: /Ship the cockpit/ }))
    await waitFor(() => expect(executionActions.getWorkbenchExecution).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole("tab", { name: "Proof" }))
    const intent = screen.getByRole("button", { name: "Ask or do anything" })
    intent.focus()

    await act(async () => { second.resolve(executionProjection("Newest execution proof")) })
    expect(document.activeElement).toBe(intent)
    expect(screen.getByRole("tab", { name: "Proof" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("button", { name: /^Thread$/ }).getAttribute("aria-pressed")).toBe("true")

    await user.click(screen.getByRole("button", { name: /^Execution$/ }))
    expect(await screen.findByText("Newest execution proof")).toBeTruthy()
    await act(async () => { first.resolve(executionProjection("Superseded execution proof")) })
    expect(screen.queryByText("Superseded execution proof")).toBeNull()
    expect(screen.getByText("Newest execution proof")).toBeTruthy()
  })

  it("labels configured HERMES provenance as inferred rather than live", () => {
    renderShell()
    const status = screen.getByLabelText("System status")
    expect(status.textContent).toContain("HERMES inferred")
    expect(status.textContent).not.toContain("HERMES live")
  })

  it("renders AEGIS from shared configured-role truth without claiming liveness", () => {
    renderShell()
    const status = screen.getByLabelText("System status")
    expect(status.textContent).toContain("AEGIS inferred")
    expect(status.textContent).not.toContain("AEGIS unknown")
    expect(status.textContent).not.toContain("AEGIS live")
    expect(screen.getByTitle("Configured as a worker node. Configuration describes role, not current liveness.")).toBeTruthy()
  })
})
