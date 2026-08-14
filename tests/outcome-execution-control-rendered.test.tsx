// @vitest-environment jsdom

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { OutcomeExecutionControl } from "@/components/workbench/outcome-execution-control"
import type { WorkbenchExecutionProjection } from "@/lib/workbench/execution-projection"

const actions = vi.hoisted(() => ({ authorizeWorkbenchOutcomeExecution: vi.fn() }))

vi.mock("@/app/actions/authorize-workbench-outcome-execution", () => ({
  authorizeWorkbenchOutcomeExecution: actions.authorizeWorkbenchOutcomeExecution,
}))

function projection(overrides: Partial<WorkbenchExecutionProjection> = {}): WorkbenchExecutionProjection {
  return {
    availability: "available",
    scope: { projectId: 7, threadId: "thread-alpha" },
    truthState: "persisted",
    observedAt: "2026-08-14T18:00:00.000Z",
    latestPersistedAt: "2026-08-14T17:59:00.000Z",
    freshness: { state: "fresh", detail: "Persisted execution evidence is current." },
    work: {
      outcomes: [{ id: "goal:GOAL-0007", title: "Ship the cockpit", state: "suggested", drilldown: { mode: "UNAVAILABLE", href: null } }],
      workOrders: [],
    },
    agents: [],
    attempts: [],
    validations: [],
    reviews: [],
    remediations: [],
    deliveries: [],
    events: [],
    evidence: [],
    recoveries: [],
    coverage: { truncated: false, truncatedKinds: [], missing: [], conflicts: [] },
    controls: { terminal: false, steer: false, pause: false, stop: false },
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe("OutcomeExecutionControl rendered authority and trust contract", () => {
  beforeEach(() => {
    actions.authorizeWorkbenchOutcomeExecution.mockReset()
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111") },
    })
  })

  afterEach(cleanup)

  it("requires two explicit foreground actions and sends one exact bounded request", async () => {
    actions.authorizeWorkbenchOutcomeExecution.mockResolvedValue({
      status: "AUTHORIZED_FOR_ACQUISITION",
      reason: null,
      projectId: 7,
      threadId: "thread-alpha",
      outcomeKey: "goal:GOAL-0007",
      observedAt: "2026-08-14T18:01:00.000Z",
      queueVersion: 1,
      authorization: {
        authorityLevel: "A2_WRITE_OWN",
        scope: "goal:GOAL-0007",
        allowedAction: "outcome:execute",
        authorizedAt: "2026-08-14T18:01:00.000Z",
        expiresAt: "2026-08-17T18:01:00.000Z",
      },
      executionObserved: false,
      workOrderObserved: false,
      leaseObserved: false,
      dispatchPerformed: false,
    })
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection()} loadState="ready" onRefresh={onRefresh} />)

    expect(screen.getByText("Awaiting authority")).toBeTruthy()
    expect(actions.authorizeWorkbenchOutcomeExecution).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Start work" }))
    expect(actions.authorizeWorkbenchOutcomeExecution).not.toHaveBeenCalled()
    expect(screen.getByText(/authorizes acquisition only/i)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Confirm Start work" }))
    await waitFor(() => expect(actions.authorizeWorkbenchOutcomeExecution).toHaveBeenCalledWith({
      projectId: 7,
      threadId: "thread-alpha",
      outcomeKey: "goal:GOAL-0007",
      idempotencyKey: "workbench-execution:11111111-1111-4111-8111-111111111111",
      confirmation: "START_WORK",
    }))
    expect(await screen.findByText("Authorized for acquisition")).toBeTruthy()
    expect(screen.getByText(/No Work Order, lease, workspace, process, or dispatch was observed/i)).toBeTruthy()
    expect(screen.queryByText(/^Working$/)).toBeNull()
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it("renders an unsupported Project as unavailable with no authority control", () => {
    render(<OutcomeExecutionControl projectId={2} threadId="thread-terrafusion" repositoryEligible={false} projection={projection({ scope: { projectId: 2, threadId: "thread-terrafusion" } })} loadState="ready" onRefresh={vi.fn()} />)

    expect(screen.getByText("Start work unavailable")).toBeTruthy()
    expect(screen.getByText(/supported primary repository/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Start work" })).toBeNull()
  })

  it("renders typed conflicts as terminal and retries only uncertain failures with the same key", async () => {
    actions.authorizeWorkbenchOutcomeExecution
      .mockRejectedValueOnce(new Error("network uncertain"))
      .mockResolvedValueOnce({
        status: "CONFLICT", reason: "IDEMPOTENCY_CONFLICT",
        projectId: 7, threadId: "thread-alpha", outcomeKey: "goal:GOAL-0007",
        observedAt: "2026-08-14T18:01:00.000Z", queueVersion: null, authorization: null,
        executionObserved: false, workOrderObserved: false, leaseObserved: false, dispatchPerformed: false,
      })
    const user = userEvent.setup()
    render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection()} loadState="ready" onRefresh={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Start work" }))
    await user.click(screen.getByRole("button", { name: "Confirm Start work" }))
    expect(await screen.findByText("Settlement unknown")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Retry confirmation" }))

    await waitFor(() => expect(actions.authorizeWorkbenchOutcomeExecution).toHaveBeenCalledTimes(2))
    const [first, second] = actions.authorizeWorkbenchOutcomeExecution.mock.calls
    expect(second[0].idempotencyKey).toBe(first[0].idempotencyKey)
    expect(await screen.findByText("Start work conflict")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })

  it.each([
    ["classified", "Owned"],
    ["approved", "Authorized"],
    ["active", "Acquired"],
    ["complete", "Completed"],
  ])("renders %s outcome truth as %s", (state, label) => {
    render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection({
      work: { outcomes: [{ id: "goal:GOAL-0007", title: "Ship", state, drilldown: { mode: "UNAVAILABLE", href: null } }], workOrders: state === "active" ? [{ id: 41, ref: "WO-41", state: "acquired", drilldown: { mode: "UNAVAILABLE", href: null } }] : [] },
    })} loadState="ready" onRefresh={vi.fn()} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it.each([
    ["validations", "Validating"],
    ["reviews", "Review"],
  ] as const)("renders current %s evidence as %s", (facet, label) => {
    const record = {
      id: `${facet}-1`, state: facet === "reviews" ? "REVIEW_PENDING" : "VALIDATING",
      summary: null, occurredAt: "2026-08-14T17:59:00.000Z", truthState: "persisted" as const,
      drilldown: { mode: "UNAVAILABLE" as const, href: null },
    }
    render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection({
      [facet]: [record],
    })} loadState="ready" onRefresh={vi.fn()} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it("requires fresh runtime checkpoints before saying Working", () => {
    const active = projection({
      work: { outcomes: [{ id: "goal:GOAL-0007", title: "Ship", state: "active", drilldown: { mode: "UNAVAILABLE", href: null } }], workOrders: [{ id: 41, ref: "WO-41", state: "in_progress", drilldown: { mode: "UNAVAILABLE", href: null } }] },
      attempts: [{ attempt: 1, currentState: "WORKING", updatedAt: "2026-08-14T17:59:00.000Z", checkpoints: [{ eventId: 1, sequence: 1, state: "WORKING", detail: null, recordedAt: "2026-08-14T17:59:00.000Z", drilldown: { mode: "UNAVAILABLE", href: null } }] }],
    })
    const { rerender } = render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={active} loadState="ready" onRefresh={vi.fn()} />)
    expect(screen.getByText("Working")).toBeTruthy()

    rerender(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={{ ...active, freshness: { state: "stale", detail: "The latest checkpoint is stale." } }} loadState="ready" onRefresh={vi.fn()} />)
    expect(screen.getByText("Recovering")).toBeTruthy()
    expect(screen.queryByText(/^Working$/)).toBeNull()
  })

  it("ignores a late authorization response after the selected Thread changes", async () => {
    const response = deferred<never>()
    actions.authorizeWorkbenchOutcomeExecution.mockReturnValue(response.promise)
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    const view = render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection()} loadState="ready" onRefresh={onRefresh} />)

    await user.click(screen.getByRole("button", { name: "Start work" }))
    await user.click(screen.getByRole("button", { name: "Confirm Start work" }))
    view.rerender(<OutcomeExecutionControl projectId={7} threadId="thread-beta" repositoryEligible projection={projection({ scope: { projectId: 7, threadId: "thread-beta" } })} loadState="ready" onRefresh={onRefresh} />)
    response.resolve({
      status: "AUTHORIZED_FOR_ACQUISITION", reason: null,
      projectId: 7, threadId: "thread-alpha", outcomeKey: "goal:GOAL-0007",
      observedAt: "2026-08-14T18:01:00.000Z", queueVersion: 1,
      authorization: { authorityLevel: "A2_WRITE_OWN", scope: "goal:GOAL-0007", allowedAction: "outcome:execute", authorizedAt: "2026-08-14T18:01:00.000Z", expiresAt: "2026-08-17T18:01:00.000Z" },
      executionObserved: false, workOrderObserved: false, leaseObserved: false, dispatchPerformed: false,
    } as never)
    await Promise.resolve()

    expect(screen.queryByText("Authorized for acquisition")).toBeNull()
    expect(screen.getByText("Awaiting authority")).toBeTruthy()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("fails closed on a typed response for a different scope", async () => {
    actions.authorizeWorkbenchOutcomeExecution.mockResolvedValue({
      status: "AUTHORIZED_FOR_ACQUISITION", reason: null,
      projectId: 7, threadId: "thread-other", outcomeKey: "goal:GOAL-0007",
      observedAt: "2026-08-14T18:01:00.000Z", queueVersion: 1,
      authorization: { authorityLevel: "A2_WRITE_OWN", scope: "goal:GOAL-0007", allowedAction: "outcome:execute", authorizedAt: "2026-08-14T18:01:00.000Z", expiresAt: "2026-08-17T18:01:00.000Z" },
      executionObserved: false, workOrderObserved: false, leaseObserved: false, dispatchPerformed: false,
    })
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection()} loadState="ready" onRefresh={onRefresh} />)

    await user.click(screen.getByRole("button", { name: "Start work" }))
    await user.click(screen.getByRole("button", { name: "Confirm Start work" }))
    await waitFor(() => expect(actions.authorizeWorkbenchOutcomeExecution).toHaveBeenCalledOnce())

    expect(screen.queryByText("Authorized for acquisition")).toBeNull()
    expect(screen.getByText("Awaiting authority")).toBeTruthy()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it.each([
    ["active", "Acquired"],
    ["complete", "Completed"],
  ])("renders progressed %s replay truth without claiming a new grant", async (outcomeState, currentLabel) => {
    const response = deferred<never>()
    actions.authorizeWorkbenchOutcomeExecution.mockReturnValue(response.promise)
    const user = userEvent.setup()
    const view = render(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection()} loadState="ready" onRefresh={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Start work" }))
    await user.click(screen.getByRole("button", { name: "Confirm Start work" }))
    view.rerender(<OutcomeExecutionControl projectId={7} threadId="thread-alpha" repositoryEligible projection={projection({
      work: {
        outcomes: [{ id: "goal:GOAL-0007", title: "Ship", state: outcomeState, drilldown: { mode: "UNAVAILABLE", href: null } }],
        workOrders: outcomeState === "active" ? [{ id: 41, ref: "WO-41", state: "acquired", drilldown: { mode: "UNAVAILABLE", href: null } }] : [],
      },
    })} loadState="ready" onRefresh={vi.fn()} />)
    response.resolve({
      status: "ALREADY_AUTHORIZED", reason: null,
      projectId: 7, threadId: "thread-alpha", outcomeKey: "goal:GOAL-0007",
      observedAt: "2026-08-14T18:01:00.000Z", queueVersion: 3,
      authorization: { authorityLevel: "A2_WRITE_OWN", scope: "goal:GOAL-0007", allowedAction: "outcome:execute", authorizedAt: "2026-08-14T18:01:00.000Z", expiresAt: "2026-08-17T18:01:00.000Z" },
      authorizationEffect: "granted_by_action", currentAuthority: "not_evaluated",
      executionObserved: true, workOrderObserved: true, leaseObserved: true, dispatchPerformed: false,
    } as never)

    expect(await screen.findByText("Already authorized")).toBeTruthy()
    expect(screen.getByText(new RegExp(`Current selected Thread status: ${currentLabel}`))).toBeTruthy()
    expect(screen.getByText(/This replay granted nothing new/i)).toBeTruthy()
    expect(screen.queryByText(/No Work Order, lease, workspace, process, or dispatch was observed/i)).toBeNull()
  })
})
