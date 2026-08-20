// @vitest-environment jsdom

import React from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { UniversalIntent } from "@/components/intent/universal-intent"

const outcomeHarness = vi.hoisted(() => ({
  start: vi.fn(),
}))

vi.mock("@/app/actions/start-workbench-outcome", () => ({
  startWorkbenchOutcome: (...args: unknown[]) => outcomeHarness.start(...args),
}))

/**
 * The composer submits an ordinary-language objective (#891, #871 boundary 1).
 *
 * The objectives below are the ones #871 actually used. One never matched a pattern, one matched two,
 * and one matched `answer` and was answered with a link to /chat. All three must become work.
 */
const NEVER_MATCHED = "Verify the deployed PACS state against the recorded completion evidence"
const ROUTED_TO_A_PAGE = "Determine what the recovered OMEN Benton database is"
const ISSUE_911 = "record structured #911 reliability remediation without host mutation"

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

const reply = (body: unknown, status = 200): FakeResponse => ({
  ok: status < 400,
  status,
  json: async () => body,
})

const CLARIFICATION = {
  state: "clarification_required",
  intent: null,
  destination: null,
  executionAuthorized: false,
  authority: { required: false, granted: false },
  reason: "No deterministic intent contract matched.",
}

const ANSWER = {
  state: "routed",
  intent: "answer",
  destination: { href: "/chat", action: "respond" },
  executionAuthorized: false,
  authority: { required: false, granted: false },
  reason: "A single deterministic intent contract matched.",
}

const NAVIGATION = {
  state: "routed",
  intent: "navigation",
  destination: { href: "/projects", action: "navigate" },
  executionAuthorized: false,
  authority: { required: false, granted: false },
  reason: "A single deterministic intent contract matched.",
}

const OUTCOME = {
  state: "routed",
  intent: "outcome",
  destination: { href: null, action: "start_outcome" },
  executionAuthorized: false,
  authority: { required: false, granted: false },
  reason: "A single deterministic intent contract matched.",
}

const acceptedOutcome = {
  status: "ACCEPTED",
  projectId: 7,
  threadId: "thread-outcome-911",
  goalId: 911,
  outcomeKey: "goal:GOAL-0911",
  root: { sourceType: "outcome", sourceId: "goal:GOAL-0911" },
  intakeTruth: "persisted",
  ownershipTruth: "project_thread_bound",
  approvalGrantedByIntake: false,
  authorityGrantedByIntake: false,
  executionAuthorizedByIntake: false,
}

const admission = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: "admitted",
  workOrder: "WO-0142",
  thread: "thread-0142",
  title: NEVER_MATCHED,
  submittedBy: "operator-1",
  authority: { granted: false, note: "admitted as a draft; execution requires a recorded authority grant" },
  ...over,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

let intentReply: () => Promise<FakeResponse>
let objectiveReply: () => Promise<FakeResponse>

const calls = () => vi.mocked(fetch).mock.calls as unknown as Array<[string, { body: string }]>
const objectiveCalls = () => calls().filter(([url]) => String(url) === "/api/objective")

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
  })
})

beforeEach(() => {
  intentReply = async () => reply(CLARIFICATION)
  objectiveReply = async () => reply(admission(), 201)
  outcomeHarness.start.mockReset()
  outcomeHarness.start.mockResolvedValue(acceptedOutcome)
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url) === "/api/intent" ? intentReply() : objectiveReply())))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("UniversalIntent shared Workbench contract", () => {
  it("starts an exact outcome in the selected Project and waits for a direct user gesture before opening its Thread", async () => {
    const user = userEvent.setup()
    const onOpenThread = vi.fn()
    intentReply = async () => reply(OUTCOME)
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={onOpenThread} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), ISSUE_911)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Awaiting authority")).toBeTruthy()
    expect(outcomeHarness.start).toHaveBeenCalledOnce()
    expect(outcomeHarness.start).toHaveBeenCalledWith({
      projectId: 7,
      intent: ISSUE_911,
      idempotencyKey: expect.stringMatching(/^workbench-outcome:[0-9a-f-]{36}$/),
    })
    expect(objectiveCalls()).toHaveLength(0)
    expect(onOpenThread).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Open Thread" }))
    expect(onOpenThread).toHaveBeenCalledOnce()
    expect(onOpenThread).toHaveBeenCalledWith({ projectId: 7, threadId: "thread-outcome-911" })
  })

  it("reuses the exact outcome intake key after an uncertain response", async () => {
    const user = userEvent.setup()
    intentReply = async () => reply(OUTCOME)
    outcomeHarness.start
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...acceptedOutcome, status: "ALREADY_ACCEPTED" })
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), ISSUE_911)
    await user.keyboard("{Enter}")
    expect((await screen.findByRole("alert")).textContent).toContain("Settlement unknown")

    await user.keyboard("{Enter}")
    expect(await screen.findByText("Awaiting authority")).toBeTruthy()
    expect(outcomeHarness.start).toHaveBeenCalledTimes(2)
    expect(outcomeHarness.start.mock.calls[1][0].idempotencyKey)
      .toBe(outcomeHarness.start.mock.calls[0][0].idempotencyKey)
  })

  it("preserves ordinary objective admission when an outcome has no selected Project", async () => {
    const user = userEvent.setup()
    intentReply = async () => reply(OUTCOME)
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), ISSUE_911)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Admitted as work")).toBeTruthy()
    expect(outcomeHarness.start).not.toHaveBeenCalled()
    expect(objectiveCalls()).toHaveLength(1)
  })

  it.each([
    "Build a useful release dashboard",
    "Fix the broken Project selector",
  ])("preserves ordinary objective admission for a generic outcome route in a selected Project: %s", async (intent) => {
    const user = userEvent.setup()
    intentReply = async () => reply(OUTCOME)
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), intent)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Admitted as work")).toBeTruthy()
    expect(outcomeHarness.start).not.toHaveBeenCalled()
    expect(objectiveCalls()).toHaveLength(1)
    expect(JSON.parse(objectiveCalls()[0][1].body)).toEqual({ objective: intent })
  })

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

  it("admits an objective the classifier never recognised, and shows what came back", async () => {
    const user = userEvent.setup()
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), NEVER_MATCHED)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Admitted as work")).toBeTruthy()
    await waitFor(() => expect(objectiveCalls()).toHaveLength(1))
    expect(JSON.parse(objectiveCalls()[0][1].body)).toEqual({ objective: NEVER_MATCHED })
    expect(screen.getByText(NEVER_MATCHED)).toBeTruthy()
    expect(screen.getByText("WO-0142")).toBeTruthy()
    expect(screen.getByText("thread-0142")).toBeTruthy()
    // Admission is not authorisation, in the response's own words.
    expect(
      screen.getByText(/Admission is not authorisation — admitted as a draft; execution requires a recorded authority grant/),
    ).toBeTruthy()
    // No Project was selected, and admission did not need one.
    expect(screen.queryByText(/Select a Project/i)).toBeNull()
  })

  it("admits an objective the classifier would have answered with a page instead of work", async () => {
    const user = userEvent.setup()
    intentReply = async () => reply(ANSWER)
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), ROUTED_TO_A_PAGE)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Admitted as work")).toBeTruthy()
    await waitFor(() => expect(objectiveCalls()).toHaveLength(1))
    expect(JSON.parse(objectiveCalls()[0][1].body)).toEqual({ objective: ROUTED_TO_A_PAGE })
    expect(screen.queryByRole("link", { name: "Open destination" })).toBeNull()
  })

  it("lets a navigation intent keep navigating without admitting anything", async () => {
    const user = userEvent.setup()
    intentReply = async () => reply(NAVIGATION)
    render(<UniversalIntent selectedProject={{ id: 7, name: "WilliamOS" }} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Open Projects")
    await user.keyboard("{Enter}")

    const destination = await screen.findByRole("link", { name: "Open destination" })
    expect(destination.getAttribute("href")).toBe("/projects")
    expect(objectiveCalls()).toHaveLength(0)
    expect(screen.queryByText("Admitted as work")).toBeNull()
  })

  it("still admits when the classifier itself is unavailable", async () => {
    const user = userEvent.setup()
    intentReply = async () => { throw new Error("classifier down") }
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), NEVER_MATCHED)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Admitted as work")).toBeTruthy()
    await waitFor(() => expect(objectiveCalls()).toHaveLength(1))
  })

  it("keeps admission while reporting a thread it could not create", async () => {
    const user = userEvent.setup()
    objectiveReply = async () => reply(admission({ thread: null, threadError: "relation workbench_thread does not exist" }), 201)
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), NEVER_MATCHED)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Admitted as work")).toBeTruthy()
    expect(screen.getByText("not created")).toBeTruthy()
    expect(screen.getByText(/its thread could not be created \(relation workbench_thread does not exist\)/)).toBeTruthy()
  })

  it("fails closed on a typed admission refusal without claiming a record", async () => {
    const user = userEvent.setup()
    objectiveReply = async () => reply({ error: "UNAUTHENTICATED" }, 401)
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), NEVER_MATCHED)
    await user.keyboard("{Enter}")

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Objective was not admitted")
    expect(alert.textContent).toContain("Sign in before submitting an objective.")
    expect(alert.textContent).toContain("Nothing was recorded")
    expect(screen.queryByText("Admitted as work")).toBeNull()
  })

  it("reports the bound refused by the objective seam rather than inventing one", async () => {
    const user = userEvent.setup()
    objectiveReply = async () => reply({ error: "OBJECTIVE_TOO_LONG", detail: "an objective may be at most 2000 characters" }, 400)
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), NEVER_MATCHED)
    await user.keyboard("{Enter}")

    expect((await screen.findByRole("alert")).textContent).toContain("An objective may be at most 2000 characters.")
  })

  it("does not admit the same unchanged objective twice", async () => {
    const user = userEvent.setup()
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), NEVER_MATCHED)
    await user.keyboard("{Enter}")
    expect(await screen.findByText("Admitted as work")).toBeTruthy()

    await user.keyboard("{Enter}")
    await user.keyboard("{Enter}")
    expect(objectiveCalls()).toHaveLength(1)
    expect(screen.getByText("WO-0142")).toBeTruthy()

    // Editing the draft makes it a different ask, and that one is admitted.
    await user.type(screen.getByRole("textbox", { name: "Intent palette" }), " again")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(objectiveCalls()).toHaveLength(2))
    expect(JSON.parse(objectiveCalls()[1][1].body)).toEqual({ objective: `${NEVER_MATCHED} again` })
  })

  it("lets a newer submission supersede an older admission response", async () => {
    const user = userEvent.setup()
    const older = deferred<FakeResponse>()
    const newer = deferred<FakeResponse>()
    const queued = [older.promise, newer.promise]
    objectiveReply = () => queued.shift()!
    render(<UniversalIntent selectedProject={null} onOpenThread={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "Ask or do anything" }), "Old objective")
    await user.keyboard("{Enter}")
    const palette = await screen.findByRole("textbox", { name: "Intent palette" })
    await user.clear(palette)
    await user.type(palette, "New objective")
    await user.keyboard("{Enter}")

    await act(async () => { newer.resolve(reply(admission({ workOrder: "WO-NEW", title: "New objective" }), 201)) })
    expect(await screen.findByText("WO-NEW")).toBeTruthy()

    await act(async () => { older.resolve(reply(admission({ workOrder: "WO-OLD", title: "Old objective" }), 201)) })
    expect(screen.getByText("WO-NEW")).toBeTruthy()
    expect(screen.queryByText("WO-OLD")).toBeNull()
  })
})
