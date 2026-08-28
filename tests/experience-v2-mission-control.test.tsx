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
    state: "saved",
    agentActivityKnown: false,
    truth: "live",
    changed: "Three sources added",
    windows: [{ id: "evidence", title: "Evidence", kind: "evidence", frame: { x: 40, y: 40, width: 900, height: 620 } }],
    agents: [],
  },
  {
    id: "recovery",
    name: "Review & Recovery",
    focus: "validation",
    state: "saved",
    truth: "live",
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

  it("renders every supplied Space as a real enterable projection without fixture or KPI copy", () => {
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId={null}
        onEnterSpace={vi.fn()}
        onDismiss={vi.fn()}
        williamOverview={{ summary: "One thing may need review.", truth: "live" }}
      />,
    )

    expect(screen.getByRole("button", { name: "Enter Review & Recovery" })).toBeTruthy()
    expect(screen.queryByText(/fixture|KPI|Home|System Space/i)).toBeNull()
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

  it("keeps the overview visible while an exact Space transition is in flight", () => {
    const onDismiss = vi.fn()
    render(<MissionControlSurface spaces={spaces} currentSpaceId="terrafusion" onEnterSpace={vi.fn()} onDismiss={onDismiss} transitioning transitionMessage="Restoring the selected Space…" />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect((screen.getByRole("button", { name: "Dismiss Mission Control" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Enter Research & Evidence" }) as HTMLButtonElement).disabled).toBe(true)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("labels inactive projections as saved state with unknown agent activity", () => {
    render(<MissionControlSurface spaces={spaces} currentSpaceId="terrafusion" onEnterSpace={vi.fn()} onDismiss={vi.fn()} />)
    const research = screen.getByRole("button", { name: "Enter Research & Evidence" })
    expect(research.textContent).toContain("Saved state")
    expect(research.textContent).toContain("Agent activity unknown")
    expect(research.textContent).not.toContain("Paused")
    expect(research.textContent).not.toContain("No active agents")
  })

  it("offers an accessible inline name-only New Space action", async () => {
    const user = userEvent.setup()
    const onCreateSpace = vi.fn(async () => true)
    render(
      <MissionControlSurface
        spaces={spaces}
        currentSpaceId="terrafusion"
        onEnterSpace={vi.fn()}
        onDismiss={vi.fn()}
        multiSpaceAvailable
        onCreateSpace={onCreateSpace}
      />,
    )
    await user.click(screen.getByRole("button", { name: "New Space" }))
    await user.type(screen.getByRole("textbox", { name: "Space name" }), "Release verification")
    await user.click(screen.getByRole("button", { name: "Create Space" }))
    expect(onCreateSpace).toHaveBeenCalledWith("Release verification")
  })

  it("disables New Space truthfully in browser-local degradation", () => {
    render(<MissionControlSurface spaces={spaces.slice(0, 1)} currentSpaceId="terrafusion" onEnterSpace={vi.fn()} onDismiss={vi.fn()} multiSpaceAvailable={false} onCreateSpace={vi.fn()} />)
    expect((screen.getByRole("button", { name: "New Space" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/server persistence is unavailable/i)).toBeTruthy()
  })

  it("keeps New Space submission single-flight under a double submit", async () => {
    let resolve!: (value: boolean) => void
    const onCreateSpace = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
    render(<MissionControlSurface spaces={spaces} currentSpaceId="terrafusion" onEnterSpace={vi.fn()} onDismiss={vi.fn()} multiSpaceAvailable onCreateSpace={onCreateSpace} />)
    fireEvent.click(screen.getByRole("button", { name: "New Space" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Space name" }), { target: { value: "Release" } })
    const form = screen.getByRole("textbox", { name: "Space name" }).closest("form")!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(onCreateSpace).toHaveBeenCalledTimes(1)
    resolve(true)
  })
})
