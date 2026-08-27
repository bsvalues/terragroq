// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  MissionControlSurface,
  type MissionControlSpaceProjection,
} from "@/components/workspace-shell/mission-control-surface"

const spaces: readonly MissionControlSpaceProjection[] = [
  {
    id: "terrafusion",
    name: "TerraFusion Build",
    focus: "development",
    state: "live",
    truth: "live",
    selectedObject: "workspace-shell.tsx",
    windows: [
      { id: "source", title: "Source", kind: "source", active: true, frame: { x: 24, y: 30, width: 760, height: 600 }, detail: "workspace-shell.tsx" },
      { id: "preview", title: "TerraFusion Preview", kind: "preview", frame: { x: 810, y: 70, width: 520, height: 500 }, detail: "live target" },
    ],
    agents: [{ id: "builder", name: "Codex", role: "Builder", activity: "implementing", state: "working" }],
  },
  {
    id: "research",
    name: "Research & Evidence",
    focus: "investigation",
    state: "paused",
    truth: "live",
    changed: "Three sources added",
    windows: [{ id: "evidence", title: "Evidence", kind: "evidence", frame: { x: 40, y: 40, width: 900, height: 620 } }],
    agents: [],
  },
  {
    id: "recovery",
    name: "Review & Recovery",
    focus: "validation",
    state: "unavailable",
    truth: "fixture",
    windows: [{ id: "tests", title: "Tests", kind: "tests", frame: { x: 80, y: 90, width: 700, height: 430 }, detail: "runtime unavailable" }],
    agents: [{ id: "local", name: "HERMES", role: "Local execution", activity: "waiting", state: "waiting" }],
  },
]

afterEach(cleanup)

describe("Experience V2 Mission Control", () => {
  it("projects supplied live Space windows instead of replacing them with KPI cards", () => {
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId="terrafusion"
        onEnterSpace={vi.fn()}
        onDismiss={vi.fn()}
        williamOverview={{ summary: "Claude found one blocking issue.", attention: "Research added three sources.", truth: "live" }}
      />,
    )

    expect(screen.getByRole("dialog", { name: "Mission Control" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enter TerraFusion Build, current Space" }).textContent).toContain("Source")
    expect(screen.getByRole("button", { name: "Enter TerraFusion Build, current Space" }).textContent).toContain("TerraFusion Preview")
    expect(screen.getByText("Selected · workspace-shell.tsx")).toBeTruthy()
    expect(screen.getByText("Codex · implementing")).toBeTruthy()
    expect(screen.queryByText(/KPI|Home|System Space|WilliamOS Space/)).toBeNull()
  })

  it("re-enters the exact selected Space id without rewriting its working context", async () => {
    const user = userEvent.setup()
    const onEnterSpace = vi.fn()
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId="terrafusion"
        onEnterSpace={onEnterSpace}
        onDismiss={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Enter Research & Evidence" }))
    expect(onEnterSpace).toHaveBeenCalledOnce()
    expect(onEnterSpace).toHaveBeenCalledWith("research")
    expect(spaces[1].windows[0]).toEqual({
      id: "evidence",
      title: "Evidence",
      kind: "evidence",
      frame: { x: 40, y: 40, width: 900, height: 620 },
    })
  })

  it("labels illustrative Space and William projections truthfully", () => {
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId={null}
        onEnterSpace={vi.fn()}
        onDismiss={vi.fn()}
        williamOverview={{ summary: "One thing may need review.", truth: "fixture" }}
      />,
    )

    const fixture = screen.getByLabelText("Review & Recovery, reference-only fixture projection")
    expect(fixture.tagName).toBe("DIV")
    expect(fixture.textContent).toContain("Fixture projection")
    expect(screen.getByText("Illustrative overview")).toBeTruthy()
    expect(screen.getByText("runtime unavailable")).toBeTruthy()
  })

  it("dismisses as an OS-level mode by button or Escape", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId="terrafusion"
        onEnterSpace={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Dismiss Mission Control" }))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it("keeps an unavailable Space present without inventing runtime state", () => {
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId="terrafusion"
        onEnterSpace={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    const recovery = screen.getByLabelText("Review & Recovery, reference-only fixture projection")
    expect(recovery.textContent).toContain("Fixture projection")
    expect(recovery.textContent).toContain("HERMES · waiting")
  })
})
