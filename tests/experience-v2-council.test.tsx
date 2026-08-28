// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BrainCouncilSurface,
  REFERENCE_COUNCIL_SESSION,
  type BrainCouncilSession,
} from "@/components/workspace-shell/brain-council-surface"

afterEach(cleanup)

const context = {
  spaceName: "TerraFusion Build",
  kind: "diff" as const,
  label: "PR #1042 · workspace shell",
  detail: "12 files changed · owner acceptance pending",
}

function renderCouncil(session: BrainCouncilSession = REFERENCE_COUNCIL_SESSION) {
  const onDismiss = vi.fn()
  const onAdvisoryAction = vi.fn()
  render(
    <BrainCouncilSurface
      selectedContext={context}
      session={session}
      onDismiss={onDismiss}
      onAdvisoryAction={onAdvisoryAction}
    />,
  )
  return { onDismiss, onAdvisoryAction }
}

describe("Experience V2 Brain Council surface", () => {
  it("binds the advisory session to the selected Space object", () => {
    renderCouncil()
    expect(screen.getByText("TerraFusion Build")).toBeTruthy()
    expect(screen.getByText("diff")).toBeTruthy()
    expect(screen.getByText("PR #1042 · workspace shell")).toBeTruthy()
    expect(screen.getByText("12 files changed · owner acceptance pending")).toBeTruthy()
  })

  it("makes roles primary while keeping provider and model metadata inspectable", () => {
    renderCouncil()
    expect(screen.getByRole("button", { name: /Architect/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Recovery \/ Risk/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Recovery \/ Risk/ }))
    expect(screen.getByText("Phoenix")).toBeTruthy()
    expect(screen.getByText("Reference fixture · role simulation")).toBeTruthy()
    expect(screen.getByText(/status wallpaper/)).toBeTruthy()
  })

  it("shows disagreement, blind spots, recommendation confidence, and evidence", () => {
    renderCouncil()
    expect(screen.getByRole("heading", { name: "Strongest dissent" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Blind spot" })).toBeTruthy()
    expect(screen.getByLabelText("82% confidence")).toBeTruthy()
    expect(screen.getByRole("complementary", { name: "Council evidence" })).toBeTruthy()
    expect(screen.getByText("Owner direction")).toBeTruthy()
  })

  it("routes owner choices through advisory callbacks without implying execution", () => {
    const { onAdvisoryAction } = renderCouncil()
    expect(screen.getByText(/recommendations never execute silently/i)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))
    expect(onAdvisoryAction).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).toHaveBeenCalledWith("approve", REFERENCE_COUNCIL_SESSION)
  })

  it("dismisses the Council without coupling dismissal to advisory actions", () => {
    const { onDismiss, onAdvisoryAction } = renderCouncil()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Brain Council" }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).not.toHaveBeenCalled()
    expect(screen.getByText(/current Space and its windows stay in place/i)).toBeTruthy()
  })
})
