import { describe, expect, it } from "vitest"

import {
  createInitialWorkbenchState,
  reduceWorkbenchState,
  serializeWorkbenchRestoration,
} from "@/lib/workbench/workbench-state"

describe("workbench foreground state", () => {
  it("changes foreground selections only through explicit user actions", () => {
    const initial = createInitialWorkbenchState()

    const withProject = reduceWorkbenchState(initial, {
      type: "USER_SELECT_PROJECT",
      projectId: "project-williamos",
      availableProjectIds: ["project-williamos"],
    })
    const withThread = reduceWorkbenchState(withProject, {
      type: "USER_SELECT_THREAD",
      threadId: "thread-777",
      availableThreadIds: ["thread-777"],
    })
    const result = reduceWorkbenchState(withThread, {
      type: "USER_SET_INSPECTOR_TAB",
      inspectorTab: "proof",
    })

    expect(result).toMatchObject({
      selectedProjectId: "project-williamos",
      selectedThreadId: "thread-777",
      inspectorTab: "proof",
    })
  })

  it("lets background refresh update freshness without stealing foreground state", () => {
    const foreground = {
      ...createInitialWorkbenchState(),
      viewMode: "activity" as const,
      selectedProjectId: "project-williamos",
      selectedThreadId: "thread-777",
      inspectorTab: "changes" as const,
      executionExpanded: true,
      foregroundFocus: "intent" as const,
      mobilePane: "inspector" as const,
    }

    const result = reduceWorkbenchState(foreground, {
      type: "BACKGROUND_REFRESH",
      version: 42,
      observedAt: "2026-08-14T15:30:00.000Z",
    })

    expect(result).toEqual({
      ...foreground,
      backgroundVersion: 42,
      backgroundObservedAt: "2026-08-14T15:30:00.000Z",
    })
  })

  it("ignores an out-of-order background refresh", () => {
    const current = {
      ...createInitialWorkbenchState(),
      backgroundVersion: 42,
      backgroundObservedAt: "2026-08-14T15:30:00.000Z",
    }

    const result = reduceWorkbenchState(current, {
      type: "BACKGROUND_REFRESH",
      version: 41,
      observedAt: "2026-08-14T15:29:00.000Z",
    })

    expect(result).toBe(current)
  })

  it("fails closed when a requested project or thread is unavailable", () => {
    const initial = createInitialWorkbenchState()
    const unavailableProject = reduceWorkbenchState(initial, {
      type: "USER_SELECT_PROJECT",
      projectId: "project-missing",
      availableProjectIds: ["project-williamos"],
    })
    const selectedProject = reduceWorkbenchState(initial, {
      type: "USER_SELECT_PROJECT",
      projectId: "project-williamos",
      availableProjectIds: ["project-williamos"],
    })
    const unavailableThread = reduceWorkbenchState(selectedProject, {
      type: "USER_SELECT_THREAD",
      threadId: "thread-missing",
      availableThreadIds: ["thread-777"],
    })

    expect(unavailableProject).toBe(initial)
    expect(unavailableThread).toBe(selectedProject)
  })

  it("does not select a thread without a selected project", () => {
    const initial = createInitialWorkbenchState()

    const result = reduceWorkbenchState(initial, {
      type: "USER_SELECT_THREAD",
      threadId: "thread-777",
      availableThreadIds: ["thread-777"],
    })

    expect(result).toBe(initial)
  })

  it("rejects malformed selection identifiers even when listed as available", () => {
    const initial = createInitialWorkbenchState()
    const malformedProject = reduceWorkbenchState(initial, {
      type: "USER_SELECT_PROJECT",
      projectId: " project-williamos ",
      availableProjectIds: [" project-williamos "],
    })
    const selectedProject = reduceWorkbenchState(initial, {
      type: "USER_SELECT_PROJECT",
      projectId: "project-williamos",
      availableProjectIds: ["project-williamos"],
    })
    const malformedThread = reduceWorkbenchState(selectedProject, {
      type: "USER_SELECT_THREAD",
      threadId: "",
      availableThreadIds: [""],
    })

    expect(malformedProject).toBe(initial)
    expect(malformedThread).toBe(selectedProject)
  })

  it("applies explicit user view, pane, and focus changes deterministically", () => {
    const initial = createInitialWorkbenchState()
    const actions = [
      { type: "USER_SET_VIEW_MODE" as const, viewMode: "system" as const },
      { type: "USER_SET_EXECUTION_EXPANDED" as const, expanded: true },
      { type: "USER_SET_FOCUS" as const, focus: "execution" as const },
      { type: "USER_SET_MOBILE_PANE" as const, pane: "execution" as const },
    ]

    const result = actions.reduce(reduceWorkbenchState, initial)

    expect(result).toMatchObject({
      viewMode: "system",
      executionExpanded: true,
      foregroundFocus: "execution",
      mobilePane: "execution",
    })
  })

  it("serializes only the non-secret foreground restoration allowlist", () => {
    const state = {
      ...createInitialWorkbenchState(),
      viewMode: "projects" as const,
      selectedProjectId: "project-williamos",
      selectedThreadId: "thread-777",
      inspectorTab: "decision" as const,
      executionExpanded: true,
      foregroundFocus: "inspector" as const,
      mobilePane: "inspector" as const,
      backgroundVersion: 91,
      backgroundObservedAt: "2026-08-14T16:00:00.000Z",
    }

    expect(JSON.parse(serializeWorkbenchRestoration(state))).toEqual({
      schemaVersion: 1,
      viewMode: "projects",
      selectedProjectId: "project-williamos",
      selectedThreadId: "thread-777",
      inspectorTab: "decision",
      executionExpanded: true,
      foregroundFocus: "inspector",
      mobilePane: "inspector",
    })
  })

  it("restores an available foreground snapshot only through a user action", () => {
    const initial = createInitialWorkbenchState()
    const restoration = JSON.stringify({
      schemaVersion: 1,
      viewMode: "projects",
      selectedProjectId: "project-williamos",
      selectedThreadId: "thread-777",
      inspectorTab: "proof",
      executionExpanded: true,
      foregroundFocus: "inspector",
      mobilePane: "inspector",
    })

    const result = reduceWorkbenchState(initial, {
      type: "USER_RESTORE_STATE",
      serialized: restoration,
      availableProjectIds: ["project-williamos"],
      availableThreadIdsByProject: {
        "project-williamos": ["thread-777"],
      },
    })

    expect(result).toEqual({
      ...initial,
      viewMode: "projects",
      selectedProjectId: "project-williamos",
      selectedThreadId: "thread-777",
      inspectorTab: "proof",
      executionExpanded: true,
      foregroundFocus: "inspector",
      mobilePane: "inspector",
    })
  })

  it("rejects a restoration whose selections are unavailable", () => {
    const initial = createInitialWorkbenchState()
    const restoration = serializeWorkbenchRestoration({
      ...initial,
      selectedProjectId: "project-missing",
    })

    const result = reduceWorkbenchState(initial, {
      type: "USER_RESTORE_STATE",
      serialized: restoration,
      availableProjectIds: ["project-williamos"],
      availableThreadIdsByProject: {},
    })

    expect(result).toBe(initial)
  })

  it("rejects malformed restoration and snapshots with arbitrary secret keys", () => {
    const initial = createInitialWorkbenchState()
    const valid = JSON.parse(serializeWorkbenchRestoration(initial))
    const attempts = ["not-json", JSON.stringify({ ...valid, sessionToken: "secret" })]

    for (const serialized of attempts) {
      expect(
        reduceWorkbenchState(initial, {
          type: "USER_RESTORE_STATE",
          serialized,
          availableProjectIds: [],
          availableThreadIdsByProject: {},
        }),
      ).toBe(initial)
    }
  })

  it("fails closed to the unchanged state for a runtime-invalid action", () => {
    const initial = createInitialWorkbenchState()
    const result = reduceWorkbenchState(initial, { type: "INVALID_RUNTIME_ACTION" } as never)

    expect(result).toBe(initial)
  })
})
