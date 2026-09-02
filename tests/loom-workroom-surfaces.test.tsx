// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkroomSurfaces } from "@/components/loom/workroom-surfaces"
import { WorkbenchContextProvider, type WorkbenchContextValue } from "@/components/workbench/workbench-context"

let mountSequence = 0

vi.mock("@/components/loom/workspace", () => ({
  Workspace: ({ projectKey }: { projectKey: string }) => <div data-testid="workspace">{projectKey}:{++mountSequence}</div>,
}))
vi.mock("@/components/loom/agent-thread", () => ({
  AgentThread: ({ projectKey }: { projectKey: string }) => <div data-testid="agent">{projectKey}:{++mountSequence}</div>,
}))
vi.mock("@/components/loom/live-console", () => ({
  LiveConsole: ({ projectKey }: { projectKey: string }) => <div data-testid="console">{projectKey}:{++mountSequence}</div>,
}))

function context(selectedProject: WorkbenchContextValue["selectedProject"]): WorkbenchContextValue {
  return { focusThread: () => undefined, selectedProject }
}

afterEach(() => {
  cleanup()
  mountSequence = 0
})

describe("Workroom project boundary", () => {
  it.each([
    [null, "no selected project"],
    [{ id: 9, key: "localops", name: "LocalOps" }, "unsupported project"],
  ] as const)("fails closed for %s", (selectedProject) => {
    render(
      <WorkbenchContextProvider value={context(selectedProject)}>
        <WorkroomSurfaces />
      </WorkbenchContextProvider>,
    )

    expect(screen.getByText("This project is not available in Workroom")).toBeTruthy()
    expect(screen.queryByTestId("workspace")).toBeNull()
    expect(screen.queryByTestId("agent")).toBeNull()
    expect(screen.queryByTestId("console")).toBeNull()
  })

  it("passes only the canonical project and remounts every surface when its identity changes", () => {
    const view = render(
      <WorkbenchContextProvider value={context({ id: 7, key: "williamos", name: "WilliamOS" })}>
        <WorkroomSurfaces />
      </WorkbenchContextProvider>,
    )
    const first = ["workspace", "agent", "console"].map((id) => screen.getByTestId(id).textContent)
    expect(first.every((value) => value?.startsWith("williamos:"))).toBe(true)

    view.rerender(
      <WorkbenchContextProvider value={context({ id: 1, key: "terrafusion", name: "TerraFusion" })}>
        <WorkroomSurfaces />
      </WorkbenchContextProvider>,
    )
    const second = ["workspace", "agent", "console"].map((id) => screen.getByTestId(id).textContent)
    expect(second.every((value) => value?.startsWith("terrafusion:"))).toBe(true)
    expect(second).not.toEqual(first)
  })
})
