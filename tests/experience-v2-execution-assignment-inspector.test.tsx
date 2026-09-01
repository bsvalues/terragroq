// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  encodeExecutionAssignmentInspectorPayload,
  EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
  executionAssignmentInspectorIdentity,
  parseExecutionAssignmentInspectorPayload,
} from "@/components/workspace-shell/execution-assignment-inspector"
import { InspectorSurfaceView, inspectorSurfaceWindowTitle } from "@/components/workspace-shell/inspector-surface"
import { defaultSpace, normalizeSpace, spaceToServer } from "@/components/workspace-shell/types"
import type { ProjectedWorldWorkerSession } from "@/lib/environment/world-execution"
import { validateSpaceState, type WorldSpine } from "@/lib/environment/working-world"

const session: ProjectedWorldWorkerSession = {
  id: "world-worker:space-experience-v2:1122:hermes-codex-bridge",
  worldId: "space-experience-v2",
  workOrderId: 1122,
  assignee: "hermes-codex-bridge",
  agent: "codex",
  role: "HERMES",
  providerLabel: "Local execution",
  assignment: "Finish Experience V2 · WO #1122: Persisted session inspection",
  status: "validating",
  evidence: "test: exact-head suite passed · PASS",
  observedAt: "2026-09-01T18:00:00.000Z",
}

const spine: WorldSpine = {
  projectId: 1,
  projectName: "WilliamOS",
  threadId: "thread-experience-v2",
  outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
  outcomeTitle: "Finish Experience V2",
  workOrderId: 1122,
  execution: "validating",
  worker: { lane: "hermes", state: "validating", since: "2026-09-01T17:45:00.000Z" },
  evidence: [
    { kind: "test", detail: "Exact-head focused suite", result: "PASS", at: "2026-09-01T17:55:00.000Z" },
    { kind: "review", detail: "Independent product review", result: "PASS", at: "2026-09-01T18:00:00.000Z" },
  ],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("persisted execution assignment Inspector", () => {
  it("captures exact Space, Outcome, Work Order, executor, and all persisted evidence", () => {
    const payload = encodeExecutionAssignmentInspectorPayload(session, spine)
    const parsed = parseExecutionAssignmentInspectorPayload(payload)

    expect(parsed).toMatchObject({
      worldId: "space-experience-v2",
      workOrderId: 1122,
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      assignee: "hermes-codex-bridge",
      agent: "codex",
      status: "validating",
    })
    expect(parsed?.evidence).toEqual(spine.evidence)
    expect(parsed?.evidenceProjection).toBe("latest-50")
    expect(executionAssignmentInspectorIdentity(parsed!)).toBe('["space-experience-v2",1122]')
  })

  it("renders the immutable persisted snapshot without probing HERMES appliance health", () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const payload = encodeExecutionAssignmentInspectorPayload(session, spine)
    const surface = {
      id: "assignment-1122",
      kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
      subject: "Work Order #1122",
      payload,
    }

    render(<InspectorSurfaceView surface={surface} />)

    expect(inspectorSurfaceWindowTitle(surface)).toBe("Assignment · Work Order #1122")
    expect(screen.getByText("Persisted assignment · runtime liveness unverified")).toBeTruthy()
    expect(screen.getByText("WILLIAMOS_EXPERIENCE_V2 · Finish Experience V2")).toBeTruthy()
    expect(screen.getByText("Latest persisted evidence · up to 50 records")).toBeTruthy()
    expect(screen.getByText("Exact-head focused suite")).toBeTruthy()
    expect(screen.getByText("Independent product review")).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("persists exact payload and geometry through the existing Space contract", () => {
    const base = defaultSpace(1400, 900, session.worldId, "Experience V2")
    const payload = encodeExecutionAssignmentInspectorPayload(session, spine)
    const geometry = { x: 191, y: 88, width: 620, height: 540, z: 22, minimized: true }
    const mapped = spaceToServer({
      ...base,
      inspectorWindows: { "assignment-1122": geometry },
      inspectorSeeds: {
        "assignment-1122": { kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND, subject: "Work Order #1122", payload },
      },
      activeWindowId: "assignment-1122",
    })

    const validated = validateSpaceState(mapped)
    const restored = normalizeSpace(validated, base, { width: 1400, height: 900 })
    expect(restored.inspectorWindows["assignment-1122"]).toEqual(geometry)
    expect(restored.inspectorSeeds["assignment-1122"]).toEqual({
      kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
      subject: "Work Order #1122",
      payload,
    })
  })

  it("does not restore or repersist another Space's assignment snapshot", () => {
    const foreignPayload = encodeExecutionAssignmentInspectorPayload(session, spine)
    const other = defaultSpace(1400, 900, "space-other", "Other Space")
    const contaminated = {
      ...spaceToServer(other),
      windows: [...spaceToServer(other).windows, {
        id: "foreign-assignment",
        kind: "inspector" as const,
        title: "Execution assignment",
        surfaceKind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
        surfaceSubject: "Work Order #1122",
        surfacePayload: foreignPayload,
        frame: { x: 100, y: 90, width: 560, height: 480 },
        z: 10,
        minimized: false,
      }],
      activeWindowId: "foreign-assignment",
    }

    const restored = normalizeSpace(validateSpaceState(contaminated), other, { width: 1400, height: 900 })
    expect(restored.inspectorSeeds["foreign-assignment"]).toBeUndefined()
    expect(restored.inspectorWindows["foreign-assignment"]).toBeUndefined()
    expect(restored.activeWindowId).toBe("editor")

    const browserContaminated = {
      ...other,
      inspectorWindows: { "foreign-assignment": { x: 100, y: 90, width: 560, height: 480, z: 10, minimized: false } },
      inspectorSeeds: {
        "foreign-assignment": { kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND, subject: "Work Order #1122", payload: foreignPayload },
      },
      activeWindowId: "foreign-assignment",
    }
    expect(spaceToServer(browserContaminated).windows.some((window) => window.id === "foreign-assignment")).toBe(false)
  })

  it("fails closed for a different Work Order context or malformed persisted payload", () => {
    expect(() => encodeExecutionAssignmentInspectorPayload(session, { ...spine, workOrderId: 1123 }))
      .toThrow("EXECUTION_ASSIGNMENT_CONTEXT_MISMATCH")
    expect(parseExecutionAssignmentInspectorPayload('{"schemaVersion":1,"kind":"execution-assignment"}')).toBeNull()

    render(<InspectorSurfaceView surface={{
      id: "assignment-invalid",
      kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
      subject: "Work Order #1122",
      payload: "{}",
    }} />)
    expect(screen.getByRole("status").textContent).toContain("snapshot unavailable")
  })

  it("preserves a legitimate persisted evidence row whose nullable notes projected to empty detail", () => {
    const payload = encodeExecutionAssignmentInspectorPayload(session, {
      ...spine,
      evidence: [{ kind: "checkpoint", detail: "", result: null, at: "2026-09-01T18:01:00.000Z" }],
    })
    expect(parseExecutionAssignmentInspectorPayload(payload)?.evidence[0]).toEqual({
      kind: "checkpoint", detail: "", result: null, at: "2026-09-01T18:01:00.000Z",
    })
    render(<InspectorSurfaceView surface={{
      id: "assignment-empty-notes",
      kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
      subject: "Work Order #1122",
      payload,
    }} />)
    expect(screen.getByText("No detail recorded")).toBeTruthy()
  })

  it("enforces the latest-50 projection and exact HERMES executor identity", () => {
    const evidence = Array.from({ length: 51 }, (_, index) => ({
      kind: "runtime",
      detail: `Record ${index + 1}`,
      result: "PASS",
      at: new Date(Date.UTC(2026, 8, 1, 18, index)).toISOString(),
    }))
    const payload = encodeExecutionAssignmentInspectorPayload(session, { ...spine, evidence })
    const parsed = parseExecutionAssignmentInspectorPayload(payload)
    expect(parsed?.evidence).toHaveLength(50)
    expect(parsed?.evidence[0].detail).toBe("Record 2")
    expect(parsed?.evidence.at(-1)?.detail).toBe("Record 51")

    const spoof = JSON.parse(payload) as Record<string, unknown>
    spoof.assignee = "other-worker"
    spoof.agent = null
    expect(parseExecutionAssignmentInspectorPayload(JSON.stringify(spoof))).toBeNull()

    const tooMany = JSON.parse(payload) as Record<string, unknown>
    tooMany.evidence = evidence
    expect(parseExecutionAssignmentInspectorPayload(JSON.stringify(tooMany))).toBeNull()
  })
})
