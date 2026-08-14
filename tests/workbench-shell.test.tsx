// @vitest-environment jsdom

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WorkbenchShell } from "@/components/workbench/workbench-shell"
import { WorkbenchActivity } from "@/components/workbench/workbench-activity"
import type { ProjectView } from "@/lib/operator/operator-state"
import type { Thread } from "@/lib/workbench/thread-projection"

const navigation = vi.hoisted(() => ({ pathname: "/", replace: vi.fn() }))
const actions = vi.hoisted(() => ({ getWorkbenchThreads: vi.fn() }))

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
vi.mock("@/components/intent/universal-intent", () => ({
  UniversalIntent: () => <button type="button">Ask or do anything</button>,
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
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
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

    navigation.pathname = "/projects"
    view.rerender(
      <WorkbenchShell user={{ id: "owner-1", name: "William", email: "owner@example.test" }} projects={projects} projectState="available" pulse={{ working: 1, needsYou: 0, queueDepth: 1 }} readiness={readiness} runtime={runtime} observedAt="2026-08-14T10:10:00.000Z">
        <p>Projects mode content</p>
      </WorkbenchShell>,
    )

    await waitFor(() => {
      const serialized = window.localStorage.getItem("williamos.workbench.layout.v1:owner-1")
      expect(serialized).toContain('"viewMode":"projects"')
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
    await waitFor(() => expect(changes.getAttribute("aria-selected")).toBe("true"))
    expect(document.activeElement).toBe(changes)

    await user.click(screen.getByRole("button", { name: /Inspect/ }))
    expect(screen.getByRole("button", { name: /Inspect/ }).getAttribute("aria-pressed")).toBe("true")

    const compactViews = screen.getByRole("navigation", { name: "Compact Workbench views" })
    expect(Array.from(compactViews.querySelectorAll("a")).map((link) => link.textContent?.trim())).toEqual([
      "Home",
      "Projects",
      "Activity",
      "System",
    ])
  })

  it("labels configured HERMES provenance as inferred rather than live", () => {
    renderShell()
    const status = screen.getByLabelText("System status")
    expect(status.textContent).toContain("HERMES inferred")
    expect(status.textContent).not.toContain("HERMES live")
  })
})
