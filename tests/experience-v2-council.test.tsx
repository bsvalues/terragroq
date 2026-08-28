// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BrainCouncilSurface,
  type BrainCouncilSession,
} from "@/components/workspace-shell/brain-council-surface"

afterEach(cleanup)

const session: BrainCouncilSession = {
  id: "council-real-session",
  question: "Council the current UX before merge.",
  status: "ready",
  context: {
    spaceName: "TerraFusion Build",
    kind: "diff",
    label: "PR #1042 · workspace shell",
  },
  members: [
    {
      id: "architect",
      role: "Architect",
      name: "Atlas",
      provider: "127.0.0.1:11434",
      model: "llama3.2:3b",
      status: "ready",
      perspective: "Keep the source and preview spatially independent.",
    },
    {
      id: "risk",
      role: "Recovery / Risk",
      name: "Phoenix",
      provider: "127.0.0.1:11434",
      model: "llama3.2:3b",
      status: "dissenting",
      perspective: "The current save and re-entry evidence is incomplete.",
    },
  ],
  consensus: "Preserve the spatial workflow.",
  dissent: "Re-entry still needs proof.",
  blindSpot: "No narrow-screen evidence exists.",
  recommendation: "Prove close and re-entry before merge.",
  confidence: 78,
  evidence: [
    { id: "selected-context", label: "Selected diff", detail: "PR #1042 · workspace shell in TerraFusion Build" },
    { id: "browser-proof", label: "browser · PASS", detail: "Window behavior passed" },
  ],
}

function renderCouncil(currentSession: BrainCouncilSession = session) {
  const onDismiss = vi.fn()
  const onAdvisoryAction = vi.fn()
  render(
    <BrainCouncilSurface
      session={currentSession}
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
  })

  it("makes roles primary while keeping provider and model metadata inspectable", () => {
    renderCouncil()
    expect(screen.getByRole("button", { name: /Architect/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Recovery \/ Risk/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Recovery \/ Risk/ }))
    expect(screen.getByText("Phoenix")).toBeTruthy()
    expect(screen.getByText("127.0.0.1:11434 · llama3.2:3b")).toBeTruthy()
    expect(screen.getByText(/save and re-entry evidence is incomplete/)).toBeTruthy()
  })

  it("shows disagreement, blind spots, recommendation confidence, and evidence", () => {
    renderCouncil()
    expect(screen.getByRole("heading", { name: "Strongest dissent" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Blind spot" })).toBeTruthy()
    expect(screen.getByLabelText("78% confidence")).toBeTruthy()
    expect(screen.getByRole("complementary", { name: "Council evidence" })).toBeTruthy()
    expect(screen.getByText("browser · PASS")).toBeTruthy()
  })

  it("routes owner choices through advisory callbacks without implying execution", () => {
    const { onAdvisoryAction } = renderCouncil()
    expect(screen.getByText(/recommendations never execute silently/i)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Approve recommendation" }))
    expect(onAdvisoryAction).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).toHaveBeenCalledWith("approve", session)
  })

  it("dismisses the Council without coupling dismissal to advisory actions", () => {
    const { onDismiss, onAdvisoryAction } = renderCouncil()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Brain Council" }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onAdvisoryAction).not.toHaveBeenCalled()
    expect(screen.getByText(/current Space and its windows stay in place/i)).toBeTruthy()
  })
})
