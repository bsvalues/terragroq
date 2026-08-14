// @vitest-environment jsdom

import React from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const outcomeActions = vi.hoisted(() => ({ startWorkbenchOutcome: vi.fn() }))
vi.mock("@/app/actions/start-workbench-outcome", () => outcomeActions)

import { UniversalIntent } from "@/components/intent/universal-intent"
import type { StartWorkbenchOutcomeResult } from "@/lib/workbench/outcome-start"

const accepted = (status: "ACCEPTED" | "ALREADY_ACCEPTED" = "ACCEPTED"): StartWorkbenchOutcomeResult => ({
  status, projectId: 7, threadId: "thread-outcome", goalId: 41,
  outcomeKey: "goal:GOAL-0041", root: { sourceType: "outcome", sourceId: "goal:GOAL-0041" },
  intakeTruth: "persisted", ownershipTruth: "project_thread_bound", approvalGrantedByIntake: false,
  authorityGrantedByIntake: false, executionAuthorizedByIntake: false,
})

const refused: StartWorkbenchOutcomeResult = {
  status: "REFUSED", projectId: 7, threadId: null, goalId: 42, outcomeKey: null, root: null,
  intakeTruth: "persisted", ownershipTruth: "unavailable", approvalGrantedByIntake: false,
  authorityGrantedByIntake: false, executionAuthorizedByIntake: false,
}

const failed = (
  status: "CONFLICT" | "INVALID_INTENT" | "PROJECT_NOT_FOUND",
): StartWorkbenchOutcomeResult => ({
  status,
  reason: status === "CONFLICT"
    ? "IDEMPOTENCY_CONFLICT"
    : status === "INVALID_INTENT" ? "ROUTE_NOT_START_OUTCOME" : "PROJECT_NOT_FOUND",
  projectId: 7,
  threadId: null,
  goalId: null,
  outcomeKey: null,
  root: null,
  intakeTruth: "unknown",
  ownershipTruth: "unavailable",
  approvalGrantedByIntake: false,
  authorityGrantedByIntake: false,
  executionAuthorizedByIntake: false,
})

function route(action: "start_outcome" | "navigate" = "start_outcome") {
  return {
    ok: true,
    json: async () => ({
      state: "routed",
      intent: action === "start_outcome" ? "outcome" : "navigation",
      destination: action === "start_outcome" ? { href: null, action } : { href: "/projects", action },
      executionAuthorized: false,
      authority: { required: false, granted: false },
      reason: "A single deterministic intent contract matched.",
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
  })
})

beforeEach(() => {
  outcomeActions.startWorkbenchOutcome.mockReset()
  outcomeActions.startWorkbenchOutcome.mockResolvedValue(accepted())
  vi.stubGlobal("fetch", vi.fn(async () => route()))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("UniversalIntent shared Workbench contract", () => {
  it("keeps a real visible composer and Ctrl+K palette on the same draft and registry", async () => {
    const user = userEvent.setup()
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    const visible = screen.getByRole("textbox", { name: "Ask or do anything" })
    await user.type(visible, "Build the useful cockpit")
    await user.keyboard("{Control>}k{/Control}")

    expect(await screen.findByRole("dialog")).toBeTruthy()
    const palette = screen.getByRole("textbox", { name: "Intent palette" }) as HTMLInputElement
    expect(document.activeElement).toBe(palette)
    expect(palette.value).toBe("Build the useful cockpit")
    expect(screen.getByRole("link", { name: "Projects" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Evidence" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Raw Runtime" })).toBeTruthy()
  })

  it("previews then explicitly accepts a Project-bound outcome without Goal Console handoff", async () => {
    const user = userEvent.setup()
    const onOpenThread = vi.fn()
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={onOpenThread} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Fix the owner handoff")
    await user.keyboard("{Enter}")
    expect(await screen.findByText("Ready to start in WilliamOS")).toBeTruthy()
    expect(outcomeActions.startWorkbenchOutcome).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Start outcome" }))
    await waitFor(() => expect(outcomeActions.startWorkbenchOutcome).toHaveBeenCalledOnce())
    expect(outcomeActions.startWorkbenchOutcome.mock.calls[0][0]).toMatchObject({ projectId: 7, intent: "Fix the owner handoff" })
    expect(outcomeActions.startWorkbenchOutcome.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText("Accepted by WilliamOS")).toBeTruthy()
    expect(screen.getByText("This intake granted no approval, authority, lease, or execution.")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Goal Console/i })).toBeNull()
    expect(onOpenThread).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Open Thread" }))
    expect(onOpenThread).toHaveBeenCalledWith({ projectId: 7, threadId: "thread-outcome" })
  })

  it("fails closed without an explicit selected Project", async () => {
    const user = userEvent.setup()
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")

    expect((await screen.findByRole("alert")).textContent).toContain("Select a Project")
    expect(screen.queryByRole("button", { name: "Start outcome" })).toBeNull()
    expect(outcomeActions.startWorkbenchOutcome).not.toHaveBeenCalled()
  })

  it("shows replay and refusal truth without claiming Working", async () => {
    const user = userEvent.setup()
    outcomeActions.startWorkbenchOutcome.mockResolvedValueOnce(accepted("ALREADY_ACCEPTED"))
    const first = render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")
    await user.click(await screen.findByRole("button", { name: "Start outcome" }))
    expect(await screen.findByText("Already accepted by WilliamOS")).toBeTruthy()
    expect(screen.getByText("This intake granted no approval, authority, lease, or execution.")).toBeTruthy()
    expect(screen.queryByText(/Unapproved and unverified|not executing/i)).toBeNull()
    expect(screen.queryByText(/Working/i)).toBeNull()
    first.unmount()

    outcomeActions.startWorkbenchOutcome.mockResolvedValueOnce(refused)
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")
    await user.click(await screen.findByRole("button", { name: "Start outcome" }))
    expect(await screen.findByText("Refused by doctrine")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Open Thread" })).toBeNull()
  })

  it("renders an idempotency conflict as a terminal typed result without recovery or retry", async () => {
    const user = userEvent.setup()
    outcomeActions.startWorkbenchOutcome.mockResolvedValueOnce(failed("CONFLICT"))
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")
    await user.click(await screen.findByRole("button", { name: "Start outcome" }))

    expect(await screen.findByText("Request identity conflict")).toBeTruthy()
    expect(screen.getByText(/already bound to a different Project or intent/i)).toBeTruthy()
    expect(screen.queryByText("Acceptance recovery required")).toBeNull()
    expect(screen.queryByRole("button", { name: "Retry acceptance" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Open Thread" })).toBeNull()
  })

  it.each([
    ["INVALID_INTENT", "Intent was not accepted"],
    ["PROJECT_NOT_FOUND", "Project unavailable"],
  ] as const)("fails closed for the typed %s result", async (status, heading) => {
    const user = userEvent.setup()
    outcomeActions.startWorkbenchOutcome.mockResolvedValueOnce(failed(status))
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")
    await user.click(await screen.findByRole("button", { name: "Start outcome" }))

    expect(await screen.findByText(heading)).toBeTruthy()
    expect(screen.getByText(/No outcome, Thread, authority, lease, or execution is claimed/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry acceptance" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Open Thread" })).toBeNull()
  })

  it("ignores a late acceptance after close and reuses the attempt key after a recoverable failure", async () => {
    const user = userEvent.setup()
    const pending = deferred<StartWorkbenchOutcomeResult>()
    outcomeActions.startWorkbenchOutcome.mockImplementationOnce(() => pending.promise)
    const onOpenThread = vi.fn()
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={onOpenThread} />)
    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")
    await user.dblClick(await screen.findByRole("button", { name: "Start outcome" }))
    expect(outcomeActions.startWorkbenchOutcome).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("status").textContent).toBe("Persisting acceptance…")
    const firstKey = outcomeActions.startWorkbenchOutcome.mock.calls[0][0].idempotencyKey
    await user.keyboard("{Escape}")
    await act(async () => { pending.resolve(accepted()) })
    expect(screen.queryByText("Accepted by WilliamOS")).toBeNull()
    expect(onOpenThread).not.toHaveBeenCalled()

    outcomeActions.startWorkbenchOutcome.mockRejectedValueOnce(new Error("WORKBENCH_OUTCOME_START_BINDING_WALL"))
    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build a release view")
    await user.keyboard("{Enter}")
    await user.click(await screen.findByRole("button", { name: "Start outcome" }))
    expect(await screen.findByText("Acceptance recovery required")).toBeTruthy()
    expect(outcomeActions.startWorkbenchOutcome.mock.calls[1][0].idempotencyKey).toBe(firstKey)
    outcomeActions.startWorkbenchOutcome.mockResolvedValueOnce(accepted("ALREADY_ACCEPTED"))
    await user.click(screen.getByRole("button", { name: "Retry acceptance" }))
    expect(await screen.findByText("Already accepted by WilliamOS")).toBeTruthy()
    expect(outcomeActions.startWorkbenchOutcome.mock.calls[2][0].idempotencyKey).toBe(firstKey)
  })

  it("lets a newer palette request supersede an older route response", async () => {
    const user = userEvent.setup()
    const older = deferred<ReturnType<typeof route>>()
    const newer = deferred<ReturnType<typeof route>>()
    vi.mocked(fetch)
      .mockImplementationOnce(() => older.promise as unknown as Promise<Response>)
      .mockImplementationOnce(() => newer.promise as unknown as Promise<Response>)
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Build the old view")
    await user.keyboard("{Enter}")
    const palette = await screen.findByRole("textbox", { name: "Intent palette" })
    await user.clear(palette)
    await user.type(palette, "Fix the newer view")
    await user.keyboard("{Enter}")
    await act(async () => { newer.resolve(route()) })
    expect(await screen.findByText("Ready to start in WilliamOS")).toBeTruthy()

    await act(async () => { older.resolve(route("navigate")) })
    expect(screen.getByText("Ready to start in WilliamOS")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Open destination" })).toBeNull()
  })
})
